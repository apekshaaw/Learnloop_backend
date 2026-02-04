const router = require("express").Router();
const { generateJSON } = require("../services/geminiService");

router.get("/gemini", async (req, res) => {
  try {
    const out = await generateJSON({
      system: "Return ONLY JSON.",
      user: `Return: {"ok": true, "modelTest": "works"}`,
    });
    res.json({ success: true, out });
  } catch (e) {
    res.status(500).json({
      success: false,
      message: e?.message,
      raw: e?.raw || null,
    });
  }
});

module.exports = router;
