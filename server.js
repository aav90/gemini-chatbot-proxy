import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from "@google/generative-ai";
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { SpeechClient } from '@google-cloud/speech';
// No need for 'fs' if using multer.memoryStorage()

// ESM specific: get __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080; // Cloud Run provides PORT env variable

// Middleware setup
app.use(express.json()); // For parsing JSON request bodies
app.use(express.urlencoded({ extended: true })); // For parsing URL-encoded request bodies

// CORS configuration: Allow only your specific domains
// For local testing, you might temporarily add 'http://localhost:8080' to the origin array
app.use(cors({ origin: ['https://learniamo.com', 'https://www.learniamo.com'] }));

// Serve static files (like index.html) from the root directory
app.use(express.static(__dirname));

// Define a route for the root URL that sends the index.html file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Set up Multer for voice file upload using memory storage
const upload = multer({ storage: multer.memoryStorage() });

// Initialize Google Cloud clients
// Ensure GEMINI_API_KEY is set in your Cloud Run environment variables
if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY environment variable is not set. Gemini API calls will fail.");
  // In a production environment, you might want to exit or throw an error here.
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Using a current and efficient model for general chat
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Initialize Text-to-Speech and Speech-to-Text clients
// These clients automatically pick up credentials from the environment (e.g., Cloud Run service account)
const ttsClient = new TextToSpeechClient();
const speechClient = new SpeechClient();

// --- API Endpoints ---

// POST route for text chat
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: "Message is required." });
    }

    console.log(`Received text message: "${message}"`);
    const result = await geminiModel.generateContent(message);
    const responseText = result.response.text();
    console.log(`Gemini text response: "${responseText}"`);

    res.json({ reply: responseText });

  } catch (err) {
    console.error("Error in /chat endpoint:", err);
    // Provide more informative error messages based on common issues
    if (err.message.includes('API key not valid')) {
      res.status(401).json({ error: "Invalid Gemini API Key. Please check your GEMINI_API_KEY environment variable." });
    } else if (err.message.includes('quota')) {
      res.status(429).json({ error: "Gemini API quota exceeded. Please check your usage limits." });
    } else {
      res.status(500).json({ error: `Failed to get Gemini response: ${String(err.message || err)}` });
    }
  }
});

// POST route for voice chat
app.post('/voice', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Audio file is required." });
    }

    // Convert audio buffer to base64 for Speech-to-Text
    const audioBytes = req.file.buffer.toString('base64');

    // Speech-to-Text request
    console.log("Sending audio to Speech-to-Text...");
    const [sttResponse] = await speechClient.recognize({
      audio: { content: audioBytes },
      config: {
        encoding: 'WEBM_OPUS', // This should match the client-side recording format
        sampleRateHertz: 48000, // This should match the client-side recording sample rate
        languageCode: 'en-US',
        model: 'default', // Use 'default' or 'command_and_search' for general purpose
      },
    });

    const transcript = sttResponse.results.map(r => r.alternatives[0].transcript).join('\n');
    if (!transcript) {
      console.warn("Speech-to-Text returned no transcript.");
      return res.status(400).json({ reply: "Could not understand the audio. Please try again." });
    }
    console.log(`STT Transcript: "${transcript}"`);

    // Send transcript to Gemini
    console.log("Sending transcript to Gemini...");
    const geminiResult = await geminiModel.generateContent(transcript);
    const geminiReply = geminiResult.response.text();
    console.log(`Gemini Reply: "${geminiReply}"`);

    // Text-to-Speech request
    console.log("Sending Gemini reply to Text-to-Speech...");
    const ttsRequest = {
      input: { text: geminiReply },
      voice: { languageCode: 'en-US', ssmlGender: 'NEUTRAL' }, // Customize voice as needed
      audioConfig: { audioEncoding: 'MP3' }, // MP3 is widely supported
    };
    const [ttsResponse] = await ttsClient.synthesizeSpeech(ttsRequest);
    console.log("Text-to-Speech audio generated.");

    res.json({ reply: geminiReply, audio: ttsResponse.audioContent.toString('base64') });

  } catch (err) {
    console.error("Error in /voice endpoint:", err);
    // More specific error handling for common issues with Google Cloud APIs
    if (err.code === 7 || err.code === 10) { // UNAUTHENTICATED or PERMISSION_DENIED
      res.status(500).json({ error: "Authentication or permission error with Google Cloud APIs (Speech-to-Text/Text-to-Speech). Check Cloud Run service account roles." });
    } else if (err.code === 3) { // INVALID_ARGUMENT
      res.status(400).json({ error: "Invalid audio format or configuration sent to Speech-to-Text. Ensure client-side recording matches backend expectations (WEBM_OPUS, 48000Hz)." });
    } else if (err.message.includes('API key not valid')) {
      res.status(401).json({ error: "Invalid Gemini API Key. Please check your GEMINI_API_KEY environment variable." });
    } else {
      res.status(500).json({ error: `Failed to process voice request: ${String(err.message || err)}` });
    }
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Access the application at http://localhost:${PORT}`);
});
