const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/authMiddleware");
const {
  addQuestion,
  getQuestions,
  submitQuiz,
  getProgress,
  getHistory,
  resetProgress,
  getStreakStatus,

  // AI
  generateAIQuiz,
  getAIQuiz,
  submitAIQuiz,
} = require("../controllers/quizController");

// -------------------
// Seeded Question Bank
// -------------------
router.post("/question", protect, addQuestion);
router.get("/questions", protect, getQuestions);
router.post("/submit", protect, submitQuiz);

// -------------------
// Progress
// -------------------
router.get("/progress", protect, getProgress);
router.get("/history", protect, getHistory);
router.post("/reset", protect, resetProgress);
router.get("/streak-status", protect, getStreakStatus);

// -------------------
// AI Quiz (NEW, separate)
// -------------------
router.post("/ai/generate", protect, generateAIQuiz);
router.get("/ai/:quizId", protect, getAIQuiz);
router.post("/ai/submit", protect, submitAIQuiz);

module.exports = router;
