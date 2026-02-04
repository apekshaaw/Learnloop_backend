const { GoogleGenerativeAI } = require("@google/generative-ai");
const PRIMARY_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const FALLBACK_MODELS = [
  "gemini-2.5-flash",
  "gemini-flash-latest",
  "gemini-2.0-flash",
  "gemini-pro-latest",
  "gemini-2.5-pro",
];

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

  const prompt = `${system}\n\n${user}`;

  async function callModel(modelName, useJsonMode) {
    const model = genAI.getGenerativeModel({ model: modelName });

    const payload = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        ...(useJsonMode ? { responseMimeType: "application/json" } : {}),
      },
    };

    return model.generateContent(payload);
  }

  const modelsToTry = [
    PRIMARY_MODEL,
    ...FALLBACK_MODELS.filter((m) => m !== PRIMARY_MODEL),
  ];

  let lastErr = null;

  for (const modelName of modelsToTry) {
    try {
      let result;

      // ✅ Try JSON mode first
      try {
        result = await callModel(modelName, true);
      } catch (e) {
        console.log("⚠️ Gemini JSON mode failed, retrying without responseMimeType...");
        console.log("JSON mode error:", e?.message || e);
        result = await callModel(modelName, false);
      }

      const text =
        result?.response?.text?.() ??
        result?.response?.candidates?.[0]?.content?.parts
          ?.map((p) => p.text)
          .join("") ??
        "";

      const jsonText = extractJSON(text);

      try {
        return JSON.parse(jsonText);
      } catch (e) {
        console.log("❌ Gemini returned non-JSON / parse failed.");
        console.log("MODEL =", modelName);
        console.log("RAW TEXT:\n", text);
        throw Object.assign(new Error("Failed to parse Gemini JSON output"), {
          raw: text,
          model: modelName,
        });
      }
    } catch (err) {
      lastErr = err;
      console.log("⚠️ Model failed, trying fallback...");
      console.log("FAILED MODEL =", modelName);
      console.log("ERR MESSAGE =", err?.message || err);
    }
  }

  console.log("❌ All Gemini models failed.");
  console.log("PRIMARY_MODEL =", PRIMARY_MODEL);
  console.log("LAST ERR =", lastErr?.message || lastErr);

  throw lastErr || new Error("All Gemini models failed");
}

module.exports = { generateJSON };
