import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from "@google/generative-ai";
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv'; // Import dotenv for local .env file support

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
    'https://gemini-chatbot-proxy-p3jxnu3yoq-ew.a.run.app',
    'https://gemini-chatbot-proxy-653233019960.europe-west1.run.app'
  ]
}));
// --- END MODIFIED CORS CONFIGURATION ---


// Serve static files (like index.html) from the root directory
app.use(express.static(__dirname));

// Define a route for the root URL that sends the index.html file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- CONVERSATION HISTORY STORAGE ---
// This will store the conversation history for a single user/session.
// For a multi-user application, you would need a more robust storage solution
// (e.g., a database, session management, or session-specific history).
// For this example, it's a simple in-memory array that resets when the server restarts.
let conversationHistory = [];
// --- END CONVERSATION HISTORY STORAGE ---


app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 

    if (!GEMINI_API_KEY) {
        console.error("GEMINI_API_KEY is not set in environment variables.");
        return res.status(500).json({ error: "Server configuration error: Gemini API key missing. Please set GEMINI_API_KEY environment variable in Cloud Run." });
    }

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    
    // --- Model Name Fix ---
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); 

    // --- MEMORY IMPLEMENTATION START ---
    // Add the user's message to the conversation history
    conversationHistory.push({ role: "user", parts: [{ text: message }] });

    // Initialize chat with the current conversation history
    const chat = model.startChat({
        history: conversationHistory, // Pass the entire history
        generationConfig: {
            maxOutputTokens: 2000, // Adjust as needed
            // You can add responseMimeType: "text/plain" here if you want plain text
        },
    });

    // Send the current message to the model
    const result = await chat.sendMessage(message);
    const responseText = result.response.text();

    // Add Gemini's reply to the conversation history
    conversationHistory.push({ role: "model", parts: [{ text: responseText }] });
    // --- MEMORY IMPLEMENTATION END ---

    res.json({ reply: responseText }); // Send back the plain text reply
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

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
