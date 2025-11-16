// models/Question.js
const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema(
  {
    level: {
      type: String, // e.g. "Class 11", "Class 12"
      required: true,
    },
    subject: {
      type: String, // e.g. "Math", "Science", "Social Studies"
      required: true,
    },
    topic: {
      type: String, // e.g. "Algebra", "Physics - Motion"
    },
    questionText: {
      type: String,
      required: true,
    },
    options: [
      {
        type: String,
        required: true,
      },
    ],
    correctOptionIndex: {
      type: Number,
      required: true,
    },
    difficulty: {
      type: String,
      enum: ["easy", "medium", "hard"],
      default: "medium",
    },
  },
  { timestamps: true }
);

const Question = mongoose.model("Question", questionSchema);

module.exports = Question;
