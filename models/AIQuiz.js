const mongoose = require("mongoose");

const aiQuizSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    level: { type: String, required: true }, 
    subject: { type: String, required: true },
    limit: { type: Number, required: true }, 

    questions: [
      {
        qid: { type: String, required: true }, 
        questionText: { type: String, required: true },
        options: { type: [String], required: true },
        correctOptionIndex: { type: Number, required: true },
        topic: { type: String, default: "" },
        difficulty: { type: String, default: "Medium" },
        explanation: { type: String, default: "" }, 
      },
    ],

    isSubmitted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AIQuiz", aiQuizSchema);
