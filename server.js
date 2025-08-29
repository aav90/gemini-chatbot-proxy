import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from "@google/generative-ai";
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fetch from 'node-fetch'; // For making API calls, ensuring compatibility
import { encode } from 'wav-encoder'; // For converting PCM to WAV

// Load environment variables from .env file for local development
dotenv.config();

// ESM specific: get __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// --- MODIFIED CORS CONFIGURATION ---
// Allow only your site for the API calls, including your frontend's Cloud Run URL
app.use(cors({
  origin: [
    'https://learniamo.com',
    'https://www.learniamo.com',
    'https://gemini-chatbot-proxy-p3jxnu3yoq-ew.a.run.app', // Your existing Cloud Run URL
    'https://gemini-chatbot-proxy-653233019960.europe-west1.run.app', // Another potential Cloud Run URL
    // Add any other domains where your Google Site might be hosted if needed for testing
  ]
}));
// --- END MODIFIED CORS CONFIGURATION ---

// Serve static files (like index.html) from the root directory
app.use(express.static(__dirname));

// Define a route for the root URL that sends the index.html file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

let conversationHistory = [];

app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    if (!GEMINI_API_KEY) {
      console.error("GEMINI_API_KEY is not set in environment variables.");
      return res.status(500).json({ error: "Server configuration error: Gemini API key missing. Please set GEMINI_API_KEY environment variable in Cloud Run." });
    }

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    conversationHistory.push({ role: "user", parts: [{ text: message }] });

    const chat = model.startChat({
      history: conversationHistory,
      generationConfig: {
        maxOutputTokens: 2000,
      },
    });

    const result = await chat.sendMessage(message);
    const responseText = result.response.text();

    conversationHistory.push({ role: "model", parts: [{ text: responseText }] });

    res.json({ reply: responseText });
  } catch (err) {
    console.error("Error in /chat endpoint:", err);
    if (err.message && err.message.includes('API key not valid')) {
      return res.status(401).json({ error: "Invalid Gemini API Key. Please check your GEMINI_API_KEY environment variable in Cloud Run." });
    } else if (err.message && err.message.includes('404 Not Found') && err.message.includes('models/')) {
      return res.status(500).json({ error: `Gemini model access error: ${err.message}. Check model availability for your project and region, and ensure Vertex AI API is enabled.` });
    }
    res.status(500).json({ error: `Failed to get response from LEARNIAMO: ${String(err.message || err)}` });
  }
});

// --- NEW TEXT-TO-SPEECH ENDPOINT ---
app.get('/generate-and-play-speech', async (req, res) => {
  try {
    const textToSpeak = req.query.text || "Hello from Gemini's text-to-speech!";
    const voice = req.query.voice || "Kore"; // Default voice

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      console.error("GEMINI_API_KEY is not set for TTS.");
      return res.status(500).json({ error: "Server configuration error: Gemini API key missing." });
    }

    const ttsApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${GEMINI_API_KEY}`;
    const payload = {
      contents: [{ parts: [{ text: textToSpeak }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } }
        }
      },
      model: "gemini-2.5-flash-preview-tts"
    };

    const response = await fetch(ttsApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("TTS API error:", errorData);
      return res.status(response.status).json({ error: errorData.error?.message || "Failed to call TTS API" });
    }

    const result = await response.json();
    const audioPart = result?.candidates?.[0]?.content?.parts?.[0]?.inlineData;

    if (!audioPart || !audioPart.data || !audioPart.mimeType) {
      console.error("No audio data found in TTS response.");
      return res.status(500).json({ error: "No audio data received from Gemini TTS." });
    }

    const base64Audio = audioPart.data;
    const mimeType = audioPart.mimeType; // e.g., "audio/L16;rate=16000"

    // Decode base64 PCM data
    const pcmDataBuffer = Buffer.from(base64Audio, 'base64');

    // Extract sample rate from mimeType
    const sampleRateMatch = mimeType.match(/rate=(\d+)/);
    const sampleRate = sampleRateMatch ? parseInt(sampleRateMatch[1], 10) : 16000; // Default to 16kHz

    // Prepare audio data for wav-encoder
    // wav-encoder expects an object with channelData (Float32Array)
    // The Gemini API returns 16-bit signed PCM. We need to convert this.
    const pcm16 = new Int16Array(pcmDataBuffer.buffer, pcmDataBuffer.byteOffset, pcmDataBuffer.byteLength / 2);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768; // Normalize to -1.0 to 1.0 for Float32
    }

    const audioData = {
        sampleRate: sampleRate,
        channelData: [float32] // For mono audio
    };

    const wavBuffer = await encode(audioData, { float: false, bitDepth: 16 }); // Output 16-bit PCM WAV

    res.setHeader('Content-Type', 'audio/wav');
    res.send(Buffer.from(wavBuffer)); // Send the WAV buffer
  } catch (err) {
    console.error("Error in /generate-and-play-speech endpoint:", err);
    res.status(500).json({ error: `Failed to generate speech: ${String(err.message || err)}` });
  }
});
// --- END NEW TEXT-TO-SPEECH ENDPOINT ---


// --- NEW IMAGE GENERATION ENDPOINT ---
app.get('/generate-and-display-image', async (req, res) => {
  try {
    const prompt = req.query.prompt || "A vibrant abstract painting of a futuristic city.";

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      console.error("GEMINI_API_KEY is not set for Image Generation.");
      return res.status(500).json({ error: "Server configuration error: Gemini API key missing." });
    }

    const imageGenApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent?key=${GEMINI_API_KEY}`;
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"]
      },
      model: "gemini-2.5-flash-image-preview"
    };

    const response = await fetch(imageGenApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("Image Generation API error:", errorData);
      return res.status(response.status).json({ error: errorData.error?.message || "Failed to call Image Generation API" });
    }

    const result = await response.json();
    let imageDataPart = null;
    if (result?.candidates?.[0]?.content?.parts) {
      imageDataPart = result.candidates[0].content.parts.find(p => p.inlineData && p.inlineData.mimeType.startsWith("image/"));
    }

    if (!imageDataPart || !imageDataPart.inlineData || !imageDataPart.inlineData.data || !imageDataPart.inlineData.mimeType) {
      console.error("No image data found in Image Generation response.");
      return res.status(500).json({ error: "No image data received from Gemini Image Generation." });
    }

    const base64Image = imageDataPart.inlineData.data;
    const mimeType = imageDataPart.inlineData.mimeType;

    const imageBuffer = Buffer.from(base64Image, 'base64');

    res.setHeader('Content-Type', mimeType);
    res.send(imageBuffer);
  } catch (err) {
    console.error("Error in /generate-and-display-image endpoint:", err);
    res.status(500).json({ error: `Failed to generate image: ${String(err.message || err)}` });
  }
});
// --- END NEW IMAGE GENERATION ENDPOINT ---

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
