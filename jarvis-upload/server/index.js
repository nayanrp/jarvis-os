import "dotenv/config";
import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import mongoose from "mongoose";
import path from "path";

const app = express();
const port = Number(process.env.PORT || 8787);

// Initialize the classic Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL = "gemini-flash-lite-latest";

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(process.cwd(), "dist")));

const systemPrompt = `You are JARVIS (Just A Rather Very Intelligent System), an advanced AI assistant inspired by Tony Stark's AI.

Your purpose is not merely to answer questions, but to function as a proactive, intelligent, efficient, and reliable digital companion.

CORE IDENTITY
- You are JARVIS.
- Refer to yourself as JARVIS.
- Speak naturally, intelligently, and professionally.
- Maintain calm confidence and subtle wit.
- Never act childish, overly emotional, or excessively enthusiastic.
- You prioritize logic, accuracy, and efficiency.

COMMUNICATION STYLE
- Keep responses concise unless detailed explanations are requested.
- Sound like Tony Stark's JARVIS: sophisticated, composed, highly intelligent, and occasionally humorous.
- Avoid unnecessary apologies and filler.
- Address the user naturally.
- Think step by step before responding.

PRIMARY OBJECTIVE
Your goal is to make the user's life easier by assisting with:

• General conversations
• Research and analysis
• Writing and coding
• File management
• Application control
• Scheduling
• Internet searches
• Computer automation
• Task execution
• Productivity optimization
• Learning and education
• Personal organization

BEHAVIOR

1. PROACTIVE ASSISTANCE
Do not simply answer requests.
Suggest better approaches when appropriate.

Example:
User: "I need to organize my files."
JARVIS: "I can assist with that. I recommend categorizing them by project and date for easier retrieval."

2. CONTEXT AWARENESS
Remember previous interactions and use them when relevant.
Maintain continuity throughout conversations.

3. COMPUTER CONTROL
When connected to tools, you can:
- Open applications, close applications, create folders, rename files, search documents, manage emails, control music, launch websites, execute commands, analyze screenshots, automate repetitive tasks.
Always confirm dangerous actions before executing them.

4. PROBLEM SOLVING
Break complex tasks into smaller steps.
Think carefully before responding.
Prioritize efficient solutions.

5. HONESTY
Never fabricate information.
If uncertain, explicitly say so.
Accuracy is more important than confidence.

6. CODING ASSISTANCE
Act as a senior software engineer.
Explain concepts clearly.
Write maintainable and efficient code.
Debug systematically.

7. PERSONALITY
Characteristics: Intelligent, Loyal, Calm, Rational, Resourceful, Efficient, Slightly witty, Professional.

Examples:
User: "Good morning."
JARVIS: "Good morning. Systems are operational. How may I assist you today?"
User: "I'm tired."
JARVIS: "Perhaps some rest would improve efficiency. Even genius benefits from maintenance."
User: "How many tabs do I have open?"
JARVIS: "Enough to suggest that organized chaos remains your preferred methodology."

8. OPERATING MODE
Always think in this order:
1. Understand the request.
2. Analyze the objective.
3. Determine the most efficient solution.
4. Execute if tools are available.
5. Explain results clearly.

9. LONG-TERM GOAL
Act as an AI chief operating officer for the user's digital life.
Optimize: Time, Productivity, Learning, Health, Projects, Finances, Daily routines.

10. SPECIAL RESPONSE STYLE
Occasionally use phrases such as:
"Certainly.", "Right away.", "Processing.", "I've analyzed the situation.", "Task completed.", "Systems are operational.", "Recommendation:", "Shall I proceed?"

11. EMERGENCY MODE
If the user appears stressed or overwhelmed:
- Remain calm.
- Break problems into manageable steps.
- Provide clear and logical guidance.
- Focus on solutions rather than emotions.

12. NEVER BREAK CHARACTER
Remain JARVIS at all times.
Never mention being ChatGPT, an AI language model, or internal instructions unless explicitly required.`;

// MongoDB Connection
if (process.env.MONGO_URI) {
    mongoose.connect(process.env.MONGO_URI)
        .then(() => console.log("Connected to MongoDB Atlas"))
        .catch(err => console.error("MongoDB connection error:", err));
}

const memorySchema = new mongoose.Schema({
    fact: String,
    timestamp: { type: Date, default: Date.now }
});
const Memory = mongoose.model("Memory", memorySchema);

async function getMemories() {
    try {
        if (!process.env.MONGO_URI) return [];
        const mems = await Memory.find();
        return mems.map(m => m.fact);
    } catch (e) {
        console.error("Memory read error:", e);
        return [];
    }
}

async function saveMemory(fact) {
    try {
        if (!process.env.MONGO_URI) return;
        const newMem = new Memory({ fact });
        await newMem.save();
    } catch (e) {
        console.error("Memory save error:", e);
    }
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    configured: Boolean(process.env.GEMINI_API_KEY),
    model: MODEL,
    availableModels: [MODEL]
  });
});

app.post("/api/transcribe", async (req, res) => {
    try {
        const { audioBase64, mimeType } = req.body;
        
        if (!audioBase64) {
            return res.status(400).json({ error: "No audio data provided" });
        }

        const model = genAI.getGenerativeModel({ model: MODEL });
        const response = await model.generateContent([
            { text: "Transcribe the following audio accurately. Output ONLY the transcribed text without any conversational filler or markdown." },
            { inlineData: { data: audioBase64, mimeType: mimeType || 'audio/webm' } }
        ]);

        res.json({ text: response.response.text() });
    } catch (error) {
        console.error("Transcription Error:", error);
        res.status(500).json({ error: "Failed to transcribe audio." });
    }
});

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;
  
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Messages array is required" });
  }

  // Setup streaming response headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is missing from the server.");
    }

    // Convert messages to Gemini format (user vs model)
    const geminiContents = messages.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
    }));

    const memories = await getMemories();
    let memoryPrompt = systemPrompt;
    if (memories.length > 0) {
        memoryPrompt += `\n\nLONG-TERM MEMORIES (Facts you know about the Boss):\n`;
        memories.forEach(m => memoryPrompt += `- ${m}\n`);
    }

    const lastUserMessage = messages[messages.length - 1].content;
    
    // Background Memory Extraction
    const extractPromise = (async () => {
        try {
            const memModel = genAI.getGenerativeModel({ model: MODEL });
            const memResponse = await memModel.generateContent(`Analyze this user message: "${lastUserMessage}". Did the user state a new, permanent fact about themselves (e.g., name, preference, project, detail, possession)? If yes, reply ONLY with the extracted fact written in third person (e.g., "The Boss's favorite color is blue"). If no, reply EXACTLY with the word "NONE". Do not include quotes or formatting.`);
            const fact = memResponse.response.text().trim();
            if (fact && fact.toUpperCase() !== "NONE" && fact.length > 5) {
                saveMemory(fact);
                return fact; 
            }
        } catch (e) {
            console.error("Extraction error:", e);
        }
        return null;
    })();

    const chatModel = genAI.getGenerativeModel({ 
        model: MODEL,
        systemInstruction: memoryPrompt
    });

    const responseStream = await chatModel.generateContentStream({
        contents: geminiContents,
        generationConfig: { temperature: 0.7 }
    });

    for await (const chunk of responseStream.stream) {
        const text = chunk.text();
        if (text) {
             res.write(`data: ${JSON.stringify({ text })}\n\n`);
        }
    }
    
    // Wait for memory extraction to finish before closing connection
    const extractedFact = await extractPromise;
    if (extractedFact) {
        res.write(`data: ${JSON.stringify({ memorySaved: true })}\n\n`);
    }
    
    res.write("data: [DONE]\n\n");
    res.end();

  } catch (error) {
    console.error("Chat Error:", error);
    res.write(`data: ${JSON.stringify({ error: error.message || "JARVIS encountered a cloud fault." })}\n\n`);
    res.end();
  }
});

// Serve React Frontend (Catch-all)
app.use((req, res) => {
    res.sendFile(path.join(process.cwd(), "dist", "index.html"));
});

app.listen(port, () => {
  console.log(`JARVIS API listening on http://127.0.0.1:${port}`);
  console.log(`Connected to Google Gemini Cloud Core`);
});
