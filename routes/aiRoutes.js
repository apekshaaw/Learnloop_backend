// routes/aiRoutes.js
const express = require("express");
const router = express.Router();

const aiController = require("../controllers/aiController");
const { protect } = require("../middleware/authMiddleware");

// keep health public if you want
router.get("/health", aiController.aiHealthCheck);

// ✅ coach must be protected (uses user data)
router.post("/coach", protect, aiController.aiCoach);

module.exports = router;
