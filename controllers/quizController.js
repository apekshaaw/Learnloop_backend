// controllers/quizController.js
const Question = require("../models/Question");
const QuizAttempt = require("../models/QuizAttempt");
const User = require("../models/User");

// Helper: simple points logic
const calculatePoints = (scorePercentage) => {
  if (scorePercentage >= 80) return 20;
  if (scorePercentage >= 60) return 10;
  return 5;
};

// @desc    Add a question (for now, we will use Postman to seed)
// @route   POST /api/quiz/question
// @access  Private (logged-in)
const addQuestion = async (req, res) => {
  try {
    const { level, subject, topic, questionText, options, correctOptionIndex, difficulty } =
      req.body;

    if (
      !level ||
      !subject ||
      !questionText ||
      !options ||
      options.length < 2 ||
      correctOptionIndex === undefined
    ) {
      return res.status(400).json({ message: "Please fill all required fields" });
    }

    const question = await Question.create({
      level,
      subject,
      topic,
      questionText,
      options,
      correctOptionIndex,
      difficulty,
    });

    return res.status(201).json({ message: "Question created", question });
  } catch (error) {
    console.error("addQuestion error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

// @desc    Get questions for a subject & level (basic "recommended" quiz)
// @route   GET /api/quiz/questions
// @access  Private
// Example: /api/quiz/questions?subject=Math&level=Class%2011&limit=10
const getQuestions = async (req, res) => {
  try {
    const { subject, level } = req.query;
    let { limit } = req.query;

    if (!subject || !level) {
      return res
        .status(400)
        .json({ message: "Subject and level are required in query" });
    }

    limit = parseInt(limit) || 10;

    // For now, simple random selection
    const questions = await Question.aggregate([
      { $match: { subject, level } },
      { $sample: { size: limit } },
    ]);

    return res.json({ questions });
  } catch (error) {
    console.error("getQuestions error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

// @desc    Submit quiz, calculate score, save attempt, update user points & streak
// @route   POST /api/quiz/submit
// @access  Private
/*
Body example:
{
  "level": "Class 11",
  "subject": "Math",
  "topic": "Algebra",
  "answers": [
    { "questionId": "......", "selectedOptionIndex": 1 },
    { "questionId": "......", "selectedOptionIndex": 2 }
  ]
}
*/
const submitQuiz = async (req, res) => {
  try {
    const { level, subject, topic, answers } = req.body;

    if (!level || !subject || !answers || !Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ message: "Invalid quiz submission data" });
    }

    // Fetch all questions for the given IDs
    const questionIds = answers.map((a) => a.questionId);
    const questions = await Question.find({ _id: { $in: questionIds } });

    let correctCount = 0;
    const questionDetails = [];

    answers.forEach((ans) => {
      const q = questions.find((qq) => qq._id.toString() === ans.questionId);
      if (!q) return;

      const isCorrect = q.correctOptionIndex === ans.selectedOptionIndex;
      if (isCorrect) correctCount++;

      questionDetails.push({
        question: q._id,
        selectedOptionIndex: ans.selectedOptionIndex,
        isCorrect,
      });
    });

    const totalQuestions = answers.length;
    const incorrectCount = totalQuestions - correctCount;
    const scorePercentage = Math.round((correctCount / totalQuestions) * 100);

    // Save attempt
    const attempt = await QuizAttempt.create({
      user: req.user._id,
      level,
      subject,
      topic,
      scorePercentage,
      totalQuestions,
      correctCount,
      incorrectCount,
      questions: questionDetails,
    });

    // Update user points & streak
    const user = await User.findById(req.user._id);

    const pointsToAdd = calculatePoints(scorePercentage);

    // Streak logic: if they answered at least one quiz today, we maintain streak,
    // if lastActiveDate is yesterday, increment streak, else reset to 1.
    const today = new Date();
    const last = user.lastActiveDate ? new Date(user.lastActiveDate) : null;

    let newStreak = 1;
    if (last) {
      const diffDays = Math.floor(
        (today.setHours(0, 0, 0, 0) - last.setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24)
      );
      if (diffDays === 0) {
        // same day, keep current streak
        newStreak = user.streak || 1;
      } else if (diffDays === 1) {
        // yesterday, increase streak
        newStreak = (user.streak || 0) + 1;
      } else {
        // gap, reset streak
        newStreak = 1;
      }
    }

    user.points = (user.points || 0) + pointsToAdd;
    user.streak = newStreak;
    user.lastActiveDate = new Date();

    await user.save();

    return res.json({
      message: "Quiz submitted",
      scorePercentage,
      correctCount,
      incorrectCount,
      totalQuestions,
      pointsEarned: pointsToAdd,
      newTotalPoints: user.points,
      newStreak: user.streak,
      attemptId: attempt._id,
    });
  } catch (error) {
    console.error("submitQuiz error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

// @desc    Get user progress summary
// @route   GET /api/quiz/progress
// @access  Private
const getProgress = async (req, res) => {
  try {
    const userId = req.user._id;

    const attempts = await QuizAttempt.find({ user: userId }).sort("-createdAt");

    // Simple summary
    const totalQuizzes = attempts.length;
    const avgScore =
      totalQuizzes === 0
        ? 0
        : Math.round(
            attempts.reduce((sum, a) => sum + a.scorePercentage, 0) / totalQuizzes
          );

    // Subject-wise average
    const subjectStats = {};
    attempts.forEach((a) => {
      if (!subjectStats[a.subject]) {
        subjectStats[a.subject] = { totalScore: 0, count: 0 };
      }
      subjectStats[a.subject].totalScore += a.scorePercentage;
      subjectStats[a.subject].count += 1;
    });

    const subjects = Object.keys(subjectStats).map((subj) => ({
      subject: subj,
      avgScore: Math.round(subjectStats[subj].totalScore / subjectStats[subj].count),
    }));

    return res.json({
      totalQuizzes,
      avgScore,
      subjects,
      recentAttempts: attempts.slice(0, 5),
    });
  } catch (error) {
    console.error("getProgress error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports = {
  addQuestion,
  getQuestions,
  submitQuiz,
  getProgress,
};
