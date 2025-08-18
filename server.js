import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { v4 as uuidv4 } from "uuid";
import { GoogleGenerativeAI } from "@google/generative-ai";

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// اتصال به Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// هیستوری هر کاربر (با سشن)
const sessions = {};

// 📌 استریمینگ + ذخیره هیستوری
app.post("/chat", async (req, res) => {
  let sessionId = req.cookies.sessionId;

  // اگر کوکی نبود → یه سشن جدید بساز
  if (!sessionId) {
    sessionId = uuidv4();
    res.cookie("sessionId", sessionId, {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // ۱ روز
    });
    sessions[sessionId] = [];
  }

  const history = sessions[sessionId] || [];
  const userMessage = req.body.message;

  // ذخیره پیام کاربر
  history.push({ role: "user", parts: [{ text: userMessage }] });

  try {
    // شروع چت با هیستوری
    const chat = model.startChat({ history });

    // استریم نتیجه
    const result = await chat.sendMessageStream(userMessage);

    // تنظیمات SSE
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

    // ذخیره پاسخ مدل در هیستوری
    history.push({ role: "model", parts: [{ text: fullResponse }] });

    // آپدیت دوباره سشن
    sessions[sessionId] = history;

    res.end();
  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).send("Error communicating with Gemini API");
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () =
