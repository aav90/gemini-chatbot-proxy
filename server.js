import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from "@google/generative-ai";
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { SpeechClient } from '@google-cloud/speech';

// Helper for ES Modules to get __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080; // Cloud Run sets the PORT environment variable

// Middleware for parsing JSON and URL-encoded request bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS configuration: Explicitly allow communication from your website and Cloud Run itself.
app.use(cors({
  origin: [
    'https://learniamo.com',          // Your primary domain
    'https://www.learniamo.com',      // Your www domain
    // Your Cloud Run service URL: Replace with your actual Cloud Run URL once deployed
    'https://gemini-chatbot-proxy-xxxxxxxxxx-ew.a.run.app' // Example: Your Cloud Run service URL
  ]
}));

// Serve static files (like index.html, style.css, client.js) from the root directory
app.use(express.static(__dirname));

// Route for the root URL to serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Multer setup for handling file uploads (specifically for audio)
const upload = multer({ storage: multer.memoryStorage() });

// Initialize Google Cloud clients
// Ensure GEMINI_API_KEY environment variable is set in your Cloud Run service
if (!process.env.GEMINI_API_KEY) {
  console.error("ERROR: GEMINI_API_KEY environment variable is not set. Gemini API calls will fail.");
  // In a production environment, you might want to terminate the process if this is critical
  // process.exit(1);
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'YOUR_GEMINI_API_KEY'); // Fallback for local testing if not set
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Initialize Text-to-Speech and Speech-to-Text clients
// These clients automatically use the Cloud Run service account credentials.
const ttsClient = new TextToSpeechClient();
const speechClient = new SpeechClient();

/**
 * Formats Gemini's plain text response into HTML paragraphs for better readability.
 * Converts double newlines into closing and opening paragraph tags.
 * @param {string} text - The raw text response from Gemini.
 * @returns {string} HTML string with paragraphs.
 */
function formatGeminiResponseForDisplay(text) {
    if (!text) return '';
    // Replace double newlines with </p><p> to create separate paragraphs
    // Handle cases where text might start/end with newlines
    let formattedText = text.trim().split('\n\n').map(p => `<p>${p.trim()}</p>`).join('');
    return formattedText;
}

// --- API Endpoints ---

// POST route for handling text-based chat messages
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: "Message is required in the request body." });
    }

    console.log(`Received text message: "${message}"`);
    const result = await geminiModel.generateContent(message);
    const responseText = result.response.text();
    console.log(`Gemini text response: "${responseText}"`);

    // Format the response for display in the UI
    const formattedReply = formatGeminiResponseForDisplay(responseText);

    res.json({ reply: formattedReply });

  } catch (err) {
    console.error("Error in /chat endpoint:", err);
    if (err.message && err.message.includes('API key not valid')) {
      return res.status(401).json({ error: "Invalid Gemini API Key. Please check your GEMINI_API_KEY environment variable in Cloud Run." });
    }
    res.status(500).json({ error: `Failed to get Gemini response: ${String(err.message || err)}` });
  }
});

// POST route for handling voice-based chat messages
app.post('/voice', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "Audio file is missing or corrupted." });
    }
    const { language } = req.body; // Expecting 'en-US' or 'fa-IR'
    const langCode = language || 'en-US'; // Default to English if not provided

    // Convert audio buffer to base64 for Speech-to-Text API
    const audioBytes = req.file.buffer.toString('base64');

    // Determine Speech-to-Text configuration based on language
    const sttConfig = {
      encoding: 'WEBM_OPUS',
      languageCode: langCode,
      // sampleRateHertz: 48000, // WEBM_OPUS might not need this explicitly if rate is implicit
    };

    // 1. Speech-to-Text: Transcribe the audio to text
    console.log(`Sending audio to Google Speech-to-Text (${langCode})...`);
    const [sttResponse] = await speechClient.recognize({
      audio: { content: audioBytes },
      config: sttConfig,
    });

    const transcript = sttResponse.results.map(r => r.alternatives[0].transcript).join('\n');
    if (!transcript) {
      console.warn("Speech-to-Text returned no transcript for the audio.");
      return res.status(400).json({ reply: "<p>Could not understand the audio. Please try speaking clearer.</p>" });
    }
    console.log(`STT Transcript: "${transcript}"`);

    // 2. Gemini API: Get a text response from Gemini
    console.log("Sending transcript to Gemini API...");
    const geminiResult = await geminiModel.generateContent(transcript);
    const geminiReply = geminiResult.response.text();
    console.log(`Gemini Reply: "${geminiReply}"`);

    // Format the response for display in the UI
    const formattedReply = formatGeminiResponseForDisplay(geminiReply);

    // Determine Text-to-Speech voice based on language
    const ttsVoice = {};
    if (langCode === 'fa-IR') {
        ttsVoice.languageCode = 'fa-IR';
        ttsVoice.ssmlGender = 'NEUTRAL'; // Or 'FEMALE', 'MALE'
        ttsVoice.name = 'fa-IR-Standard-D'; // A standard Farsi voice
    } else { // Default to en-US
        ttsVoice.languageCode = 'en-US';
        ttsVoice.ssmlGender = 'NEUTRAL';
        ttsVoice.name = 'en-US-Standard-C'; // A standard English voice
    }

    // 3. Text-to-Speech: Convert Gemini's text response into audio
    console.log(`Sending Gemini reply to Google Text-to-Speech (${ttsVoice.languageCode})...`);
    const ttsRequest = {
      input: { text: geminiReply }, // Use the raw geminiReply for TTS
      voice: ttsVoice,
      audioConfig: { audioEncoding: 'MP3' },
    };
    const [ttsResponse] = await ttsClient.synthesizeSpeech(ttsRequest);
    console.log("Text-to-Speech audio generated.");

    // Send back Gemini's formatted text reply and the generated audio (base64 encoded)
    res.json({ reply: formattedReply, audio: ttsResponse.audioContent.toString('base64') });

  } catch (err) {
    console.error("Error in /voice endpoint:", err);
    if (err.code === 7 || err.code === 10) { // UNAUTHENTICATED or PERMISSION_DENIED
      return res.status(500).json({ error: "Authentication/Permission error with Google Cloud APIs (Speech-to-Text/Text-to-Speech). Check Cloud Run service account roles." });
    } else if (err.code === 3) { // INVALID_ARGUMENT
      return res.status(400).json({ error: "Invalid audio format or configuration sent to Speech-to-Text. Ensure client-side recording matches backend expectations (WEBM_OPUS)." });
    } else if (err.message && err.message.includes('API key not valid')) {
      return res.status(401).json({ error: "Invalid Gemini API Key. Please check your GEMINI_API_KEY environment variable in Cloud Run." });
    }
    res.status(500).json({ error: `Failed to process voice request: ${String(err.message || err)}` });
  }
});

// Start the server and listen for incoming requests
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Access the application locally at http://localhost:${PORT}`);
});
