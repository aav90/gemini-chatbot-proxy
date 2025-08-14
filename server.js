import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from "@google/generative-ai";
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer'; // For handling file uploads (voice)
import { TextToSpeechClient } from '@google-cloud/text-to-speech'; // For Text-to-Speech
import { SpeechClient } from '@google-cloud/speech'; // For Speech-to-Text
import fs from 'fs'; // For file system operations (Multer temp files)

// ESM specific: get __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json()); // For parsing JSON request bodies
app.use(express.urlencoded({ extended: true })); // For parsing URL-encoded request bodies

// Allow only your site for the API calls
app.use(cors({ origin: ['https://learniamo.com', 'https://www.learniamo.com'] }));

// Serve static files (like index.html) from the root directory
app.use(express.static(__dirname));

// Define a route for the root URL that sends the index.html file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Set up Multer for voice file upload
// Use memory storage for smaller files to avoid disk I/O, or configure diskStorage carefully
const upload = multer({ storage: multer.memoryStorage() }); 

// Initialize Google Cloud clients
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
const ttsClient = new TextToSpeechClient();
const speechClient = new SpeechClient();

// POST route for text chat
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: "Message is required." });
    }

    const result = await geminiModel.generateContent(message);
    res.json({ reply: result.response.text() });
  } catch (err) {
    console.error("Error in /chat:", err);
    res.status(500).json({ error: `Failed to get Gemini response: ${String(err)}` });
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
    const [sttResponse] = await speechClient.recognize({
      audio: { content: audioBytes },
      config: { 
        encoding: 'WEBM_OPUS', // <--- CHANGED TO WEBM_OPUS
        sampleRateHertz: 48000, // <--- CHANGED TO 48000
        languageCode: 'en-US',
      },
    });

    const transcript = sttResponse.results.map(r => r.alternatives[0].transcript).join('\n');
    if (!transcript) {
      return res.status(400).json({ reply: "Could not understand the audio. Please try again." });
    }

    // Send transcript to Gemini
    const geminiResult = await geminiModel.generateContent(transcript);
    const geminiReply = geminiResult.response.text();

    // Text-to-Speech request
    const ttsRequest = {
      input: { text: geminiReply },
      voice: { languageCode: 'en-US', ssmlGender: 'NEUTRAL' }, // You can customize voice
      audioConfig: { audioEncoding: 'MP3' },
    };
    const [ttsResponse] = await ttsClient.synthesizeSpeech(ttsRequest);

    res.json({ reply: geminiReply, audio: ttsResponse.audioContent.toString('base64') });

  } catch (err) {
    console.error("Error in /voice:", err);
    // More specific error handling for common issues
    if (err.code === 7 || err.code === 10) { // UNAUTHENTICATED or PERMISSION_DENIED
        res.status(500).json({ error: "Authentication or permission error with Google Cloud APIs. Check service account roles." });
    } else if (err.code === 3) { // INVALID_ARGUMENT
        res.status(400).json({ error: "Invalid audio format or configuration. Ensure client-side recording matches backend expectations." });
    } else {
        res.status(500).json({ error: `Failed to process voice request: ${String(err)}` });
    }
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
