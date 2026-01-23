// controllers/aiController.js
const aiService = require("../services/aiService"); // Flask passthrough (optional)
const aiCoachService = require("../services/aiCoachService");

// ---------- helpers ----------
function detectIntent(message = "") {
  const m = String(message || "").trim().toLowerCase();

  // Tutor intent examples:
  // "teach me algebra", "teach me trigonometry", "teach me integration"
  // "explain algebra", "help me learn algebra"
  const tutor =
    m.startsWith("teach me ") ||
    m.startsWith("teach ") ||
    m.startsWith("explain ") ||
    m.includes("teach me") ||
    m.includes("help me learn") ||
    m.includes("teach me algebra");

  // Plan intent examples:
  // "7 day plan", "7-day plan", "study plan"
  const plan =
    m.includes("7 day") ||
    m.includes("7-day") ||
    m.includes("seven day") ||
    m.includes("study plan");

  if (tutor) return "tutor";
  if (plan) return "plan";
  return "coach";
}

exports.aiHealthCheck = async (req, res) => {
  try {
    const health = await aiService.healthCheck();
    res.json(health);
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "AI service unavailable",
      error: error.message,
    });
  }
};

// POST /api/ai/coach
exports.aiCoach = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { message = "", mode = "auto" } = req.body || {};

    // ✅ Decide mode from user message when mode=auto
    const intent = detectIntent(message);
    const resolvedMode = mode === "auto" ? intent : mode; // tutor | plan | coach | (manual override)

    const result = await aiCoachService.coach({
      userId,
      message,
      mode: resolvedMode,
      intent, // optional extra info (safe to ignore if service doesn't use it)
    });

    // Ensure frontend gets: res.data.data
    return res.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "AI Coach failed",
      error: error.message,
    });
  }
};
