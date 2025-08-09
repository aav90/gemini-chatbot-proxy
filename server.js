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

// Allow only your site for the API calls
app.use(cors({ origin: 'https://learniamo.com' }));


// --- NEW CODE START ---
// Serve static files (like index.html) from the root directory
app.use(express.static(__dirname));

// Define a route for the root URL that sends the index.html file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
// --- NEW CODE END ---


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
