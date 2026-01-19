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

// ------------------------------
// CONFIG (tweak anytime)
// ------------------------------
const ALLOWED_LIMITS = new Set([5, 10, 15]);
const DEFAULT_LIMIT = 10;

// How many recent attempts to look back to avoid repeats
const RECENT_ATTEMPTS_LOOKBACK = 10;

// Hard cap: how many recent question IDs we keep in memory to exclude
const RECENT_QUESTION_ID_CAP = 200;

// @desc    Add a question (for now, we will use Postman to seed)
// @route   POST /api/quiz/question
// @access  Private (logged-in)
const addQuestion = async (req, res) => {
  try {
    const {
      level,
      subject,
      topic,
      questionText,
      options,
      correctOptionIndex,
      difficulty,
    } = req.body;

    if (
      !level ||
      !subject ||
      !questionText ||
      !options ||
      !Array.isArray(options) ||
      options.length < 2 ||
      correctOptionIndex === undefined
    ) {
      return res.status(400).json({ message: "Please fill all required fields" });
    }

    if (
      typeof correctOptionIndex !== "number" ||
      correctOptionIndex < 0 ||
      correctOptionIndex >= options.length
    ) {
      return res.status(400).json({ message: "correctOptionIndex is invalid" });
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

// @desc    Get randomized questions for a subject & level
//          Avoid repeating recently served questions for the same user+subject+level
// @route   GET /api/quiz/questions
// @access  Private
// Example: /api/quiz/questions?subject=Physics&level=Class%2011&limit=10
const getQuestions = async (req, res) => {
  try {
    const { subject, level } = req.query;
    let { limit } = req.query;

    if (!subject || !level) {
      return res
        .status(400)
        .json({ message: "Subject and level are required in query" });
    }

    // limit hygiene: only allow 5/10/15 (default 10)
    const parsed = parseInt(limit, 10);
    limit = ALLOWED_LIMITS.has(parsed) ? parsed : DEFAULT_LIMIT;

    // Total available in the bank
    const availableTotal = await Question.countDocuments({ subject, level });

    if (availableTotal === 0) {
      return res.json({
        questions: [],
        meta: {
          subject,
          level,
          requested: limit,
          returned: 0,
          availableTotal: 0,
          note: "No questions exist for this subject+level yet. Seed the bank.",
        },
      });
    }

    // 1) Build a set of recently served question IDs for THIS user+subject+level
    // We look back at recent attempts and collect question IDs
    const recentAttempts = await QuizAttempt.find({
      user: req.user._id,
      subject,
      level,
    })
      .sort({ createdAt: -1 })
      .limit(RECENT_ATTEMPTS_LOOKBACK)
      .select("questions.question")
      .lean();

    const recentIds = [];
    for (const attempt of recentAttempts) {
      if (!attempt?.questions?.length) continue;
      for (const q of attempt.questions) {
        if (q?.question) recentIds.push(String(q.question));
        if (recentIds.length >= RECENT_QUESTION_ID_CAP) break;
      }
      if (recentIds.length >= RECENT_QUESTION_ID_CAP) break;
    }

    const mongoose = require("mongoose");
const recentObjectIds = recentIds
  .map((id) => new mongoose.Types.ObjectId(id));


    // 2) First try: sample from questions NOT in recent list
    let freshQuestions = [];
    if (recentObjectIds.length > 0) {
      freshQuestions = await Question.aggregate([
        { $match: { subject, level, _id: { $nin: recentObjectIds } } },
        { $sample: { size: limit } },
      ]);
    } else {
      freshQuestions = await Question.aggregate([
        { $match: { subject, level } },
        { $sample: { size: limit } },
      ]);
    }

    // 3) If we couldn't get enough fresh (bank too small), fill the rest by sampling from ALL
    let questions = freshQuestions;
    if (questions.length < limit) {
      const remaining = limit - questions.length;

      const alreadyPicked = new Set(questions.map((q) => String(q._id)));

      const filler = await Question.aggregate([
        { $match: { subject, level } },
        { $sample: { size: Math.min(remaining * 3, limit * 3) } }, // oversample then dedupe locally
      ]);

      for (const q of filler) {
        const id = String(q._id);
        if (alreadyPicked.has(id)) continue;
        questions.push(q);
        alreadyPicked.add(id);
        if (questions.length === limit) break;
      }
    }

    // Final note for UI/debug
    let note = "OK";
    if (availableTotal < limit) {
      note = `Only ${availableTotal} questions exist in the bank for this subject+level, so we returned ${questions.length}. Seed more to unlock ${limit}.`;
    } else if (recentSet.size > 0 && questions.length > 0) {
      // If we had recent questions, we attempted to avoid them
      note = "Returned randomized questions (avoiding recently seen when possible).";
    }

    return res.json({
      questions,
      meta: {
        subject,
        level,
        requested: limit,
        returned: questions.length,
        availableTotal,
        note,
      },
    });
  } catch (error) {
    console.error("getQuestions error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

// @desc    Submit quiz, calculate score, save attempt, update user points & streak
// @route   POST /api/quiz/submit
// @access  Private
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

    const today = new Date();
    const last = user.lastActiveDate ? new Date(user.lastActiveDate) : null;

    let newStreak = 1;
    if (last) {
      const diffDays = Math.floor(
        (today.setHours(0, 0, 0, 0) - last.setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24)
      );
      if (diffDays === 0) newStreak = user.streak || 1;
      else if (diffDays === 1) newStreak = (user.streak || 0) + 1;
      else newStreak = 1;
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

    const totalQuizzes = attempts.length;
    const avgScore =
      totalQuizzes === 0
        ? 0
        : Math.round(
            attempts.reduce((sum, a) => sum + a.scorePercentage, 0) / totalQuizzes
          );

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

// @desc    Get quiz history (latest attempts)
// @route   GET /api/quiz/history
// @access  Private
const getHistory = async (req, res) => {
  try {
    const { limit = 20 } = req.query;

    const attempts = await QuizAttempt.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(limit, 10) || 20, 100))
      .select("level subject topic scorePercentage totalQuestions correctCount incorrectCount createdAt")
      .lean();

    return res.json({ attempts });
  } catch (error) {
    console.error("getHistory error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

// @desc    Reset user's quiz progress (attempts + points/streak)
// @route   POST /api/quiz/reset
// @access  Private
const resetProgress = async (req, res) => {
  try {
    const userId = req.user._id;

    const del = await QuizAttempt.deleteMany({ user: userId });

    const user = await User.findById(userId);
    if (user) {
      user.points = 0;
      user.streak = 0;
      user.lastActiveDate = null;
      await user.save();
    }

    return res.json({
      message: "Progress reset",
      deletedAttempts: del.deletedCount,
      points: user?.points ?? 0,
      streak: user?.streak ?? 0,
    });
  } catch (error) {
    console.error("resetProgress error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};


module.exports = {
  addQuestion,
  getQuestions,
  submitQuiz,
  getProgress,
  getHistory,
  resetProgress,
};
