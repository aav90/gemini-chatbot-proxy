import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from "@google/generative-ai";
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { SpeechClient } from '@google-cloud/speech';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// IMPORTANT: This CORS configuration is crucial.
// It allows requests from your Cloud Run URL itself (if embedded directly)
// and your learniamo.com domain.
app.use(cors({ origin: ['https://learniamo.com', 'https://www.learniamo.com', 'https://gemini-chatbot-proxy-653233019960.europe-west1.run.app'] }));

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const upload = multer({ storage: multer.memoryStorage() });

if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY environment variable is not set. Gemini API calls will fail.");
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const ttsClient = new TextToSpeechClient();
const speechClient = new SpeechClient();

app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: "Message is required." });
    }
    const result = await geminiModel.generateContent(message);
    const responseText = result.response.text();
    res.json({ reply: responseText });
  } catch (err) {
    console.error("Error in /chat endpoint:", err);
    if (err.message.includes('API key not valid')) {
      res.status(401).json({ error: "Invalid Gemini API Key. Please check your GEMINI_API_KEY environment variable." });
    } else {
      res.status(500).json({ error: `Failed to get Gemini response: ${String(err.message || err)}` });
    }
  }
});

app.post('/voice', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Audio file is required." });
    }
    const audioBytes = req.file.buffer.toString('base64');

    const [sttResponse] = await speechClient.recognize({
      audio: { content: audioBytes },
      config: {
        encoding: 'WEBM_OPUS',
        sampleRateHertz: 48000,
        languageCode: 'en-US',
        model: 'default',
      },
    });

    const transcript = sttResponse.results.map(r => r.alternatives[0].transcript).join('\n');
    if (!transcript) {
      return res.status(400).json({ reply: "Could not understand the audio. Please try again." });
    }

    const geminiResult = await geminiModel.generateContent(transcript);
    const geminiReply = geminiResult.response.text();

    const ttsRequest = {
      input: { text: geminiReply },
      voice: { languageCode: 'en-US', ssmlGender: 'NEUTRAL' },
      audioConfig: { audioEncoding: 'MP3' },
    };
    const [ttsResponse] = await ttsClient.synthesizeSpeech(ttsRequest);

    res.json({ reply: geminiReply, audio: ttsResponse.audioContent.toString('base64') });
  } catch (err) {
    console.error("Error in /voice endpoint:", err);
    if (err.code === 7 || err.code === 10) {
      res.status(500).json({ error: "Authentication or permission error with Google Cloud APIs (Speech-to-Text/Text-to-Speech). Check Cloud Run service account roles." });
    } else if (err.code === 3) {
      res.status(400).json({ error: "Invalid audio format or configuration sent to Speech-to-Text. Ensure client-side recording matches backend expectations (WEBM_OPUS, 48000Hz)." });
    } else if (err.message.includes('API key not valid')) {
      res.status(401).json({ error: "Invalid Gemini API Key. Please check your GEMINI_API_KEY environment variable." });
    } else {
      res.status(500).json({ error: `Failed to process voice request: ${String(err.message || err)}` });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
