import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { GoogleGenerativeAI } from "@google/generative-ai";
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { SpeechClient } from '@google-cloud/speech';
import { getSessionId, getHistory, addToHistory } from './chatHistory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// CORS config
app.use(cors({
  origin: ['https://learniamo.com', 'https://www.learniamo.com'],
  credentials: true
}));

// Static files
app.use(express.static(__dirname));

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const upload = multer({ storage: multer.memoryStorage() });

// Google Clients
if (!process.env.GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY not set!");
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const ttsClient = new TextToSpeechClient();
const speechClient = new SpeechClient();

function formatReply(text) {
  if (!text) return '';
  return text.trim().split('\n\n').map(p => `<p>${p.trim()}</p>`).join('');
}

// ---- Chat endpoint ----
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message required" });

    const sessionId = getSessionId(req, res);
    const history = getHistory(sessionId);

    addToHistory(sessionId, "user", message);

    const result = await geminiModel.generateContent({
      contents: history
    });

    const responseText = result.response.text();
    addToHistory(sessionId, "model", responseText);

    res.json({ reply: formatReply(responseText) });
  } catch (err) {
    console.error("❌ Chat error:", err);
    res.status(500).json({ error: "Failed to get Gemini response" });
  }
});

// ---- Voice endpoint ----
app.post('/voice', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ error: "Audio file missing" });
    }
    const { language } = req.body;
    const langCode = language || 'en-US';

    const audioBytes = req.file.buffer.toString('base64');

    const sttConfig = { encoding: 'WEBM_OPUS', languageCode: langCode };

    const [sttResponse] = await speechClient.recognize({
      audio: { content: audioBytes },
      config: sttConfig,
    });

    const transcript = sttResponse.results.map(r => r.alternatives[0].transcript).join('\n');
    if (!transcript) {
      return res.status(400).json({ reply: "<p>Could not understand audio.</p>" });
    }

    const sessionId = getSessionId(req, res);
    addToHistory(sessionId, "user", transcript);

    const geminiResult = await geminiModel.generateContent({
      contents: getHistory(sessionId)
    });
    const geminiReply = geminiResult.response.text();
    addToHistory(sessionId, "model", geminiReply);

    // Voice selection
    const ttsVoice = langCode === 'fa-IR'
      ? { languageCode: 'fa-IR', name: 'fa-IR-Standard-D', ssmlGender: 'FEMALE' }
      : { languageCode: 'en-US', name: 'en-US-Standard-F', ssmlGender: 'FEMALE' };

    const [ttsResponse] = await ttsClient.synthesizeSpeech({
      input: { text: geminiReply },
      voice: ttsVoice,
      audioConfig: { audioEncoding: 'MP3' }
    });

    res.json({ reply: formatReply(geminiReply), audio: ttsResponse.audioContent.toString('base64') });
  } catch (err) {
    console.error("❌ Voice error:", err);
    res.status(500).json({ error: "Voice processing failed" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
