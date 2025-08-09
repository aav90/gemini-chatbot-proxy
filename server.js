import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from "@google/generative-ai";

const app = express();
app.use(express.json());

// Allow only your site
app.use(cors({ origin: 'https://learniamo.com' }));

app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const result = await model.generateContent(message);
    res.json({ reply: result.response.text() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
