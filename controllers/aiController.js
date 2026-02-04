const aiService = require("../services/aiService"); 
const aiCoachService = require("../services/aiCoachService");

function detectIntent(message = "") {
  const m = String(message || "").trim().toLowerCase();


  const tutor =
    m.startsWith("teach me ") ||
    m.startsWith("teach ") ||
    m.startsWith("explain ") ||
    m.includes("teach me") ||
    m.includes("help me learn") ||
    m.includes("teach me algebra");


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

exports.aiCoach = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { message = "", mode = "auto" } = req.body || {};

    const intent = detectIntent(message);
    const resolvedMode = mode === "auto" ? intent : mode; 

    const result = await aiCoachService.coach({
      userId,
      message,
      mode: resolvedMode,
      intent, 
    });

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
