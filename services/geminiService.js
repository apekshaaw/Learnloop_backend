// services/geminiService.js
const { GoogleGenerativeAI } = require("@google/generative-ai");

const MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";

function extractJSON(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  if (raw.startsWith("{") && raw.endsWith("}")) return raw;
  const match = raw.match(/\{[\s\S]*\}/);
  return match ? match[0].trim() : raw;
}

async function generateJSON({ system, user }) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing in .env");
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: MODEL });

  const prompt = `${system}\n\n${user}`;

  const callGemini = async (useJsonMode) => {
    const payload = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        ...(useJsonMode ? { responseMimeType: "application/json" } : {}),
      },
    };
    return model.generateContent(payload);
  };

  try {
    let result;

    // ✅ Try JSON mode first
    try {
      result = await callGemini(true);
    } catch (e) {
      // ✅ Some accounts/models reject responseMimeType → retry without it
      console.log("⚠️ Gemini JSON mode failed, retrying without responseMimeType...");
      console.log("JSON mode error:", e?.message || e);
      result = await callGemini(false);
    }

    const text =
      result?.response?.text?.() ??
      result?.response?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ??
      "";

    const jsonText = extractJSON(text);

    try {
      return JSON.parse(jsonText);
    } catch (e) {
      console.log("❌ Gemini returned non-JSON / parse failed.");
      console.log("RAW TEXT:\n", text);
      throw Object.assign(new Error("Failed to parse Gemini JSON output"), { raw: text });
    }
  } catch (err) {
    console.log("❌ Gemini API call failed:");
    console.log("MODEL =", MODEL);
    console.log("ERR MESSAGE =", err?.message);
    console.log("FULL ERR =", err);
    throw err;
  }
}

module.exports = { generateJSON };
