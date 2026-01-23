// models/AIQuiz.js
const mongoose = require("mongoose");

const aiQuizSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    level: { type: String, required: true }, // "Class 11" | "Class 12"
    subject: { type: String, required: true },
    limit: { type: Number, required: true }, // 5/10/15

    // store the AI-generated questions with correct answers
    questions: [
      {
        qid: { type: String, required: true }, // stable id e.g. "Q1"
        questionText: { type: String, required: true },
        options: { type: [String], required: true },
        correctOptionIndex: { type: Number, required: true },
        topic: { type: String, default: "" },
        difficulty: { type: String, default: "Medium" }, // Easy/Medium/Hard
        explanation: { type: String, default: "" }, // for later “Explain Mistakes”
      },
    ],

    // status
    isSubmitted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AIQuiz", aiQuizSchema);
