import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from "@google/generative-ai";
import path from 'path'; // Import the 'path' module
import { fileURLToPath } from 'url'; // For ESM compatibility

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
    // Add the specific Cloud Run URL where your frontend is hosted
    'https://gemini-chatbot-proxy-p3jxnu3yoq-ew.a.run.app',
    // It's also good practice to include the backend's own URL if it's the target for fetches
    // Though sometimes not strictly necessary if the request always comes from the frontend origin
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


app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;
    // IMPORTANT: Access API key from environment variable
    // For Cloud Run, set GEMINI_API_KEY as an environment variable in the service settings.
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 

    if (!GEMINI_API_KEY) {
        console.error("GEMINI_API_KEY is not set.");
        return res.status(500).json({ error: "Server configuration error: Gemini API key missing." });
    }

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    // Note: "gemini-2.0-flash" is not a standard model ID.
    // Use "gemini-pro" for text-only, or "gemini-1.5-flash" for newer versions if you have access.
    const model = genAI.getGenerativeModel({ model: "gemini-pro" }); 

    const result = await model.generateContent(message);
    res.json({ reply: result.response.text() });
  } catch (err) {
    console.error("Error in /chat endpoint:", err);
    if (err.message && err.message.includes('API key not valid')) {
      return res.status(401).json({ error: "Invalid Gemini API Key. Please check your GEMINI_API_KEY environment variable in Cloud Run." });
    }
    res.status(500).json({ error: String(err.message || err) }); // Provide error message for debugging
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
