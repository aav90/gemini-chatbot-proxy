import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';
import textToSpeech from '@google-cloud/text-to-speech';
import speech from '@google-cloud/speech';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors({ origin: ['https://learniamo.com', 'https://www.learniamo.com'] }));
app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Set up Multer for voice file upload
const upload = multer({ dest: 'uploads/' });

// POST route for text chat
app.post('/chat', async (req, res) => {
    try {
        const { message } = req.body;
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
        const result = await model.generateContent(message);
        res.json({ reply: result.response.text() });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: String(err) });
    }
});

// POST route for voice chat
app.post('/voice', upload.single('audio'), async (req, res) => {
    try {
        const client = new speech.SpeechClient();
        const file = fs.readFileSync(req.file.path);
        const audioBytes = file.toString('base64');

        const [response] = await client.recognize({
            audio: { content: audioBytes },
            config: { encoding: 'LINEAR16', sampleRateHertz: 44100, languageCode: 'en-US' },
        });

        const transcript = response.results.map(r => r.alternatives[0].transcript).join('\n');

        // Send transcript to Gemini
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
        const result = await model.generateContent(transcript);

        // Convert Gemini response to speech
        const ttsClient = new textToSpeech.TextToSpeechClient();
        const ttsRequest = {
            input: { text: result.response.text() },
            voice: { languageCode: 'en-US', ssmlGender: 'NEUTRAL' },
            audioConfig: { audioEncoding: 'MP3' },
        };
        const [ttsResponse] = await ttsClient.synthesizeSpeech(ttsRequest);

        // Delete uploaded file
        fs.unlinkSync(req.file.path);

        res.json({ reply: result.response.text(), audio: ttsResponse.audioContent.toString('base64') });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: String(err) });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
