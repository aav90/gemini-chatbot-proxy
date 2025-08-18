import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { v4 as uuidv4 } from "uuid";
import { GoogleGenerativeAI } from "@google/generative-ai";

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Gemini API
if (!process.env.GEMINI_API_KEY) {
  console.error("ERROR: GEMINI_API_KEY environment variable is not set!");
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// ذخیره هیستوری برای هر سشن
const sessions = {};

// فرمت کردن متن برای نمایش در UI
function formatTextForDisplay(text) {
  if (!text) return "";
  return text.trim().split("\n\n").map(p => `<p>${p.trim()}</p>`).join("");
}

// 📌 استریمینگ + هیستوری
app.post("/chat", async (req, res) => {
  let sessionId = req.cookies.sessionId;

  if (!sessionId) {
    sessionId = uuidv4();
    res.cookie("sessionId", sessionId, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 });
    sessions[sessionId] = [];
  }

  const history = sessions[sessionId];
  const userMessage = req.body.message;
  history.push({ role: "user", content: userMessage });

  try {
    const chat = model.startChat({ history });
    const result = await chat.sendMessageStream(userMessage);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let fullResponse = "";

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        fullResponse += text;
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    history.push({ role: "model", content: fullResponse });
    res.end();

  } catch (error) {
    console.error(error);
    res.status(500).send("Error communicating with Gemini API");
  }
});

const PO
