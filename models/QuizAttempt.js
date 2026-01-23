const mongoose = require("mongoose");

const quizAttemptSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    level: { type: String, required: true },
    subject: { type: String, required: true },
    topic: { type: String },

    source: { type: String, enum: ["BANK", "AI"], default: "BANK" },
    aiQuizId: { type: mongoose.Schema.Types.ObjectId, ref: "AIQuizSession", default: null },

    scorePercentage: { type: Number, required: true },
    totalQuestions: { type: Number, required: true },
    correctCount: { type: Number, required: true },
    incorrectCount: { type: Number, required: true },

    questions: [
      {
        question: { type: mongoose.Schema.Types.ObjectId, ref: "Question", default: null },
        selectedOptionIndex: Number,
        isCorrect: Boolean,

        source: { type: String, enum: ["BANK", "AI"], default: "BANK" },

        // for AI attempts only (optional)
        ai: {
          questionText: { type: String, default: "" },
          options: { type: [String], default: [] },
          correctOptionIndex: { type: Number, default: -1 },
          explanation: { type: String, default: "" },
          topic: { type: String, default: "" },
          difficulty: { type: String, default: "Medium" },
        },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("QuizAttempt", quizAttemptSchema);
