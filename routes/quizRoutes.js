// routes/quizRoutes.js
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
} = require("../controllers/quizController");

// Add a question (you'll use Postman, not from app)
router.post("/question", protect, addQuestion);

// Get questions for subject & level (for LearnLoop quiz screen)
router.get("/questions", protect, getQuestions);

// Submit quiz
router.post("/submit", protect, submitQuiz);

// Get progress summary
router.get("/progress", protect, getProgress);

router.get("/history", protect, getHistory);
router.post("/reset", protect, resetProgress);

module.exports = router;
