import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from "@google/generative-ai";
import path from 'path'; // Import the 'path' module
import { fileURLToPath } from 'url'; // For ESM compatibility
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

    // Add a check to ensure the API key is present
    if (!GEMINI_API_KEY) {
        console.error("GEMINI_API_KEY is not set in environment variables.");
        return res.status(500).json({ error: "Server configuration error: Gemini API key missing. Please set GEMINI_API_KEY environment variable in Cloud Run." });
    }

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    
    // --- Model Name Fix ---
    // Changed model to 'gemini-1.5-flash' for broader availability and better performance.
    // If 'gemini-1.5-flash' is not available in your region/project,
    // you might need to revert to 'gemini-1.0-pro' if that starts working,
    // or contact Google Cloud Support for model access in your region/project.
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); 

    const result = await model.generateContent(message);
    res.json({ reply: result.response.text() });
  } catch (err) {
    console.error("Error in /chat endpoint:", err);
    // Provide more specific error messages for debugging
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
