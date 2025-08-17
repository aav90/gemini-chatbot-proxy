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
// This is critical for preventing browser security errors.
app.use(cors({
  origin: [
    'https://learniamo.com',          // Your primary domain
    'https://www.learniamo.com',      // Your www domain
    'https://gemini-chatbot-proxy-653233019960.europe-west1.run.app' // Your Cloud Run service URL
  ]
}));

// Serve static files (like index.html) from the root directory
app.use(express.static(__dirname));

// Route for the root URL to serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Multer setup for handling file uploads (specifically for audio)
// Uses memory storage, so files are kept in buffer
const upload = multer({ storage: multer.memoryStorage() });

// Initialize Google Cloud clients
// Ensure GEMINI_API_KEY environment variable is set in your Cloud Run service
if (!process.env.GEMINI_API_KEY) {
  console.error("ERROR: GEMINI_API_KEY environment variable is not set. Gemini API calls will fail.");
  // Consider process.exit(1) in a production environment if this is critical
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Use a capable and efficient Gemini model for general chat
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Initialize Text-to-Speech and Speech-to-Text clients
// These clients automatically use the Cloud Run service account credentials.
const ttsClient = new TextToSpeechClient();
const speechClient = new SpeechClient();

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

    res.json({ reply: responseText });

  } catch (err) {
    console.error("Error in /chat endpoint:", err);
    // Provide specific error messages for common API issues
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

    // Convert audio buffer to base64 for Speech-to-Text API
    const audioBytes = req.file.buffer.toString('base64');

    // 1. Speech-to-Text: Transcribe the audio to text
    console.log("Sending audio to Google Speech-to-Text...");
    const [sttResponse] = await speechClient.recognize({
      audio: { content: audioBytes },
      config: {
        encoding: 'WEBM_OPUS',       // Must match client-side recording format
        sampleRateHertz: 48000,     // Must match client-side recording sample rate
        languageCode: 'en-US',
        model: 'default',           // Use a general-purpose model
      },
    });

    const transcript = sttResponse.results.map(r => r.alternatives[0].transcript).join('\n');
    if (!transcript) {
      console.warn("Speech-to-Text returned no transcript for the audio.");
      return res.status(400).json({ reply: "Could not understand the audio. Please try speaking clearer." });
    }
    console.log(`STT Transcript: "${transcript}"`);

    // 2. Gemini API: Get a text response from Gemini
    console.log("Sending transcript to Gemini API...");
    const geminiResult = await geminiModel.generateContent(transcript);
    const geminiReply = geminiResult.response.text();
    console.log(`Gemini Reply: "${geminiReply}"`);

    // 3. Text-to-Speech: Convert Gemini's text response into audio
    console.log("Sending Gemini reply to Google Text-to-Speech...");
    const ttsRequest = {
      input: { text: geminiReply },
      voice: { languageCode: 'en-US', ssmlGender: 'NEUTRAL' }, // Customize voice as needed
      audioConfig: { audioEncoding: 'MP3' }, // MP3 is widely supported by browsers
    };
    const [ttsResponse] = await ttsClient.synthesizeSpeech(ttsRequest);
    console.log("Text-to-Speech audio generated.");

    // Send back Gemini's text reply and the generated audio (base64 encoded)
    res.json({ reply: geminiReply, audio: ttsResponse.audioContent.toString('base64') });

  } catch (err) {
    console.error("Error in /voice endpoint:", err);
    // More specific error handling for common Google Cloud API issues
    if (err.code === 7 || err.code === 10) { // UNAUTHENTICATED or PERMISSION_DENIED
      return res.status(500).json({ error: "Authentication/Permission error with Google Cloud APIs (Speech-to-Text/Text-to-Speech). Check Cloud Run service account roles." });
    } else if (err.code === 3) { // INVALID_ARGUMENT
      return res.status(400).json({ error: "Invalid audio format or configuration sent to Speech-to-Text. Ensure client-side recording matches backend expectations (WEBM_OPUS, 48000Hz)." });
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
