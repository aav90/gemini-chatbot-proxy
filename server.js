const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config(); // Load environment variables from .env file

const app = express();
const port = 3000;

// Middleware to parse JSON bodies
app.use(express.json());
// Serve static files from the current directory (for index.html)
app.use(express.static(__dirname));

// Access your API key as an environment variable
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is not set in environment variables.');
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Define the model
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

// This will store the conversation history for a single user/session.
// For a multi-user application, you would need a more robust storage solution
// (e.g., a database, session management, or session-specific history).
// For this example, it's a simple in-memory array that resets when the server restarts.
let conversationHistory = [];

app.post('/chat', async (req, res) => {
    const userMessage = req.body.message;

    if (!userMessage) {
        return res.status(400).json({ error: 'Message is required' });
    }

    try {
        // Add the user's message to the conversation history
        conversationHistory.push({ role: "user", parts: [{ text: userMessage }] });

        // Initialize chat with the current conversation history
        const chat = model.startChat({
            history: conversationHistory,
            generationConfig: {
                maxOutputTokens: 2000, // Adjust as needed
                // Instruct Gemini to prefer markdown for better readability
                responseMimeType: "text/markdown", 
            },
        });

        // Send the current message to the model
        const result = await chat.sendMessage(userMessage);
        const response = result.response;
        const geminiReply = response.text();

        // Add Gemini's reply to the conversation history
        conversationHistory.push({ role: "model", parts: [{ text: geminiReply }] });

        res.json({ reply: geminiReply });

    } catch (error) {
        console.error('Error interacting with Gemini API:', error);
        res.status(500).json({ error: 'Failed to get response from LEARNIAMO API.' });
    }
});

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});
