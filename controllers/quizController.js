const Question = require("../models/Question");
const QuizAttempt = require("../models/QuizAttempt");
const User = require("../models/User");
const AIQuiz = require("../models/AIQuiz"); 
const mongoose = require("mongoose");
const { generateJSON } = require("../services/geminiService"); 

const calculatePoints = (scorePercentage) => {
  if (scorePercentage >= 80) return 20;
  if (scorePercentage >= 60) return 10;
  return 5;
};


const ALLOWED_LIMITS = new Set([5, 10, 15]);
const DEFAULT_LIMIT = 10;

const RECENT_ATTEMPTS_LOOKBACK = 10;

const RECENT_QUESTION_ID_CAP = 200;


const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const daysBetween = (a, b) => {
  const A = startOfDay(a).getTime();
  const B = startOfDay(b).getTime();
  return Math.floor((A - B) / (1000 * 60 * 60 * 24));
};


const unlock = async (user, key) => {
  user.achievements = user.achievements || [];
  const already = user.achievements.some((a) => a.key === key);
  if (!already) {
    user.achievements.push({ key, unlockedAt: new Date() });
    return true;
  }
  return false;
};

const calcSubjectAvg = async (userId, subject) => {
  const attempts = await QuizAttempt.find({ user: userId, subject })
    .sort({ createdAt: -1 })
    .limit(50)
    .select("scorePercentage")
    .lean();

  const count = attempts.length;
  if (count === 0) return { count: 0, avg: 0 };

  const avg = Math.round(attempts.reduce((s, a) => s + a.scorePercentage, 0) / count);
  return { count, avg };
};

const applyGamification = async ({
  userId,
  scorePercentage,
  totalQuestions,
  subject,
  attemptId,
}) => {
  const user = await User.findById(userId);

  const pointsToAdd = calculatePoints(scorePercentage);

  const now = new Date();
  const last = user.lastActiveDate ? new Date(user.lastActiveDate) : null;

  let newStreak = 1;

  if (last) {
    const diffDays = daysBetween(now, last);

    if (diffDays === 0) {
      newStreak = user.streak || 1;
    } else if (diffDays === 1) {
      newStreak = (user.streak || 0) + 1;
    } else if (diffDays === 2) {
      if (totalQuestions === 5 && (user.streak || 0) > 0) {
        newStreak = (user.streak || 0) + 1;

        user.streakSave = user.streakSave || { lastUsedAt: null, totalUsed: 0 };
        user.streakSave.lastUsedAt = new Date();
        user.streakSave.totalUsed = (user.streakSave.totalUsed || 0) + 1;
      } else {
        newStreak = 1;
      }
    } else {
      newStreak = 1;
    }
  }

  user.points = (user.points || 0) + pointsToAdd;
  user.streak = newStreak;
  user.lastActiveDate = new Date();

  const totalAttempts = await QuizAttempt.countDocuments({ user: userId });

  if (totalAttempts === 1) await unlock(user, "FIRST_QUIZ");
  if (newStreak >= 3) await unlock(user, "STREAK_3");
  if (newStreak >= 7) await unlock(user, "STREAK_7");

  const prevAttempt = await QuizAttempt.findOne({
    user: userId,
    subject,
    _id: { $ne: attemptId },
  })
    .sort({ createdAt: -1 })
    .select("scorePercentage")
    .lean();

  if (prevAttempt && scorePercentage - prevAttempt.scorePercentage >= 20) {
    await unlock(user, "COMEBACK");
  }

  const { count, avg } = await calcSubjectAvg(userId, subject);
  if (count >= 3 && avg >= 80) {
    await unlock(user, "SUBJECT_MASTERY");
  }

  await user.save();

  return { user, pointsToAdd };
};


const addQuestion = async (req, res) => {
  try {
    const { level, subject, topic, questionText, options, correctOptionIndex, difficulty } =
      req.body;

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

const getQuestions = async (req, res) => {
  try {
    const { subject, level } = req.query;
    let { limit } = req.query;

    if (!subject || !level) {
      return res.status(400).json({ message: "Subject and level are required in query" });
    }

    const parsed = parseInt(limit, 10);
    limit = ALLOWED_LIMITS.has(parsed) ? parsed : DEFAULT_LIMIT;

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

    const recentObjectIds = recentIds
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    let questions = [];
    if (recentObjectIds.length > 0) {
      questions = await Question.aggregate([
        { $match: { subject, level, _id: { $nin: recentObjectIds } } },
        { $sample: { size: limit } },
      ]);
    } else {
      questions = await Question.aggregate([
        { $match: { subject, level } },
        { $sample: { size: limit } },
      ]);
    }

    if (questions.length < limit) {
      const remaining = limit - questions.length;
      const alreadyPicked = new Set(questions.map((q) => String(q._id)));

      const filler = await Question.aggregate([
        { $match: { subject, level } },
        { $sample: { size: Math.min(remaining * 3, limit * 3) } },
      ]);

      for (const q of filler) {
        const id = String(q._id);
        if (alreadyPicked.has(id)) continue;
        questions.push(q);
        alreadyPicked.add(id);
        if (questions.length === limit) break;
      }
    }

    return res.json({
      questions,
      meta: {
        subject,
        level,
        requested: limit,
        returned: questions.length,
        availableTotal,
        note: "OK",
      },
    });
  } catch (error) {
    console.error("getQuestions error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

const submitQuiz = async (req, res) => {
  try {
    const { level, subject, topic, answers } = req.body;

    if (!level || !subject || !Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ message: "Invalid quiz submission data" });
    }

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
        source: "BANK",
      });
    });

    const totalQuestions = answers.length;
    const incorrectCount = totalQuestions - correctCount;
    const scorePercentage = Math.round((correctCount / totalQuestions) * 100);

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
      source: "BANK",
    });

    const { user, pointsToAdd } = await applyGamification({
      userId: req.user._id,
      scorePercentage,
      totalQuestions,
      subject,
      attemptId: attempt._id,
    });

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

    // ---- NEW: Breakdown (BANK vs AI) ----
    const bySource = (src) => attempts.filter((a) => a.source === src);

    const buildBlock = (srcAttempts) => {
      const total = srcAttempts.length;
      const avg =
        total === 0
          ? 0
          : Math.round(
              srcAttempts.reduce((sum, a) => sum + a.scorePercentage, 0) / total
            );

      const stat = {};
      srcAttempts.forEach((a) => {
        if (!stat[a.subject]) stat[a.subject] = { totalScore: 0, count: 0 };
        stat[a.subject].totalScore += a.scorePercentage;
        stat[a.subject].count += 1;
      });

      const subs = Object.keys(stat).map((s) => ({
        subject: s,
        avgScore: Math.round(stat[s].totalScore / stat[s].count),
        attempts: stat[s].count,
      }));

      return { totalQuizzes: total, avgScore: avg, subjects: subs };
    };

    const bankAttempts = bySource("BANK");
    const aiAttempts = bySource("AI");

    return res.json({
      // ✅ keep current frontend working
      totalQuizzes,
      avgScore,
      subjects,
      recentAttempts: attempts.slice(0, 5),

      // ✅ extra data for AI Coach / future UI
      breakdown: {
        bank: buildBlock(bankAttempts),
        ai: buildBlock(aiAttempts),
      },
    });
  } catch (error) {
    console.error("getProgress error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

const getHistory = async (req, res) => {
  try {
    const { limit = 20 } = req.query;

    const attempts = await QuizAttempt.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(limit, 10) || 20, 100))
      .select(
        "level subject topic scorePercentage totalQuestions correctCount incorrectCount createdAt source"
      )
      .lean();

    return res.json({ attempts });
  } catch (error) {
    console.error("getHistory error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

const getStreakStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("streak lastActiveDate");
    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.lastActiveDate) {
      return res.json({
        daysSinceActive: null,
        atRisk: false,
        canSave: false,
        reason: "No activity yet",
      });
    }

    const diffDays = daysBetween(new Date(), user.lastActiveDate);

    const atRisk = diffDays === 2 && (user.streak || 0) > 0;
    const canSave = atRisk;

    return res.json({
      daysSinceActive: diffDays,
      atRisk,
      canSave,
    });
  } catch (e) {
    console.error("getStreakStatus error:", e.message);
    return res.status(500).json({ message: "Server error" });
  }
};

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

// =====================================================
// ✅ AI QUIZ (GEMINI + FALLBACK)
// =====================================================

const isQuotaOrAuthError = (err) => {
  const msg = String(err?.message || "").toLowerCase();

  return (
    msg.includes("401") ||
    msg.includes("unauthorized") ||
    msg.includes("permission") ||
    msg.includes("403") ||
    msg.includes("429") ||
    msg.includes("quota") ||
    msg.includes("rate") ||
    msg.includes("exceeded") ||
    msg.includes("api key")
  );
};

const normalizeQuestion = (q, idx) => {
  const options = Array.isArray(q?.options) ? q.options.map(String) : [];
  let correct = Number(q?.correctOptionIndex);

  if (options.length !== 4) return null;
  if (!Number.isInteger(correct) || correct < 0 || correct > 3) return null;

  const qt = String(q?.questionText || "").trim();
  if (!qt) return null;

  return {
    qid: String(q?.qid || `Q${idx + 1}`),
    questionText: qt,
    options,
    correctOptionIndex: correct,
    topic: String(q?.topic || ""),
    difficulty: String(q?.difficulty || "Medium"),
    explanation: String(q?.explanation || ""),
  };
};

// Fallback generator: uses your seeded bank to keep UI working when Gemini is down/quota.
const generateQuestionsFromBankAsAIShape = async ({ subject, level, count }) => {
  const docs = await Question.aggregate([
    { $match: { subject, level } },
    { $sample: { size: count } },
  ]);

  if (!Array.isArray(docs) || docs.length !== count) {
    throw new Error(
      "Gemini unavailable AND not enough seeded questions to fallback. Seed more questions."
    );
  }

  return docs.map((q, idx) => ({
    qid: `Q${idx + 1}`,
    questionText: String(q.questionText || "").trim(),
    options: Array.isArray(q.options) ? q.options.map(String) : [],
    correctOptionIndex: Number(q.correctOptionIndex),
    topic: String(q.topic || ""),
    difficulty: String(q.difficulty || "Medium"),
    explanation: "", // bank doesn’t store explanation; keep empty
  }));
};

// ✅ REAL AI generator (Gemini JSON) + fallback
const generateQuestionsWithAI = async ({ subject, level, count }) => {
  const system = `You are an exam question generator for Nepal +2.
Return ONLY valid JSON (no markdown) matching the schema.`;

  const user = `Generate ${count} MCQs for:
- Subject: ${subject}
- Level: ${level}

Rules:
- Exactly ${count} questions
- Each must have 4 options
- correctOptionIndex must be 0..3
- Include short explanation
- Keep difficulty mixed: Easy/Medium/Hard
- Avoid trick ambiguous questions

JSON schema:
{
  "questions": [
    {
      "qid": "Q1",
      "questionText": "string",
      "options": ["A","B","C","D"],
      "correctOptionIndex": 0,
      "topic": "string",
      "difficulty": "Easy|Medium|Hard",
      "explanation": "string"
    }
  ]
}`;

  try {
    const result = await generateJSON({ system, user });
    const arr = result?.questions;

    if (!Array.isArray(arr) || arr.length !== count) {
      throw new Error("AI returned invalid quiz format");
    }

    const normalized = arr.map((q, idx) => normalizeQuestion(q, idx)).filter(Boolean);

    if (normalized.length !== count) {
      throw new Error("AI quiz normalization failed (bad question fields)");
    }

    return { questions: normalized, source: "GEMINI" };
  } catch (err) {
    if (isQuotaOrAuthError(err)) {
      const fallback = await generateQuestionsFromBankAsAIShape({ subject, level, count });
      return { questions: fallback, source: "BANK_FALLBACK" };
    }
    throw err;
  }
};

// POST /api/quiz/ai/generate
const generateAIQuiz = async (req, res) => {
  try {
    const { subject, level } = req.body;
    let { limit } = req.body;

    if (!subject || !level) {
      return res.status(400).json({ message: "subject and level are required" });
    }

    const parsed = parseInt(limit, 10);
    limit = ALLOWED_LIMITS.has(parsed) ? parsed : DEFAULT_LIMIT;

    const { questions, source } = await generateQuestionsWithAI({
      subject,
      level,
      count: limit,
    });

    // Store in AIQuiz as usual (even when fallback is used)
    const quiz = await AIQuiz.create({
      user: req.user._id,
      level,
      subject,
      limit,
      questions,
      isSubmitted: false,
      // NOTE: only add this if your AIQuiz schema allows extra fields; if not, remove it.
      // generatorSource: source,
    });

    // safe response (no answers)
    const safeQuestions = quiz.questions.map((q) => ({
      qid: q.qid,
      questionText: q.questionText,
      options: q.options,
      topic: q.topic || "",
      difficulty: q.difficulty || "Medium",
    }));

    return res.status(201).json({
      quizId: quiz._id,
      subject,
      level,
      totalQuestions: limit,
      questions: safeQuestions,
      meta: { source },
    });
  } catch (error) {
    console.error("generateAIQuiz error:", error.message);
    return res.status(500).json({ message: error.message || "Server error" });
  }
};

// GET /api/quiz/ai/:quizId
const getAIQuiz = async (req, res) => {
  try {
    const { quizId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(quizId)) {
      return res.status(400).json({ message: "Invalid quizId" });
    }

    const quiz = await AIQuiz.findOne({ _id: quizId, user: req.user._id }).lean();
    if (!quiz) return res.status(404).json({ message: "AI quiz not found" });

    const safeQuestions = (quiz.questions || []).map((q) => ({
      qid: q.qid,
      questionText: q.questionText,
      options: q.options,
      topic: q.topic || "",
      difficulty: q.difficulty || "Medium",
    }));

    return res.json({
      quizId: quiz._id,
      subject: quiz.subject,
      level: quiz.level,
      totalQuestions: quiz.limit,
      questions: safeQuestions,
      isSubmitted: quiz.isSubmitted,
    });
  } catch (error) {
    console.error("getAIQuiz error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

// POST /api/quiz/ai/submit
// body: { quizId, answers: [{ qid, selectedOptionIndex }] }
const submitAIQuiz = async (req, res) => {
  try {
    const { quizId, answers } = req.body;

    if (!quizId || !Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ message: "quizId and answers are required" });
    }

    if (!mongoose.Types.ObjectId.isValid(quizId)) {
      return res.status(400).json({ message: "Invalid quizId" });
    }

    const quiz = await AIQuiz.findOne({ _id: quizId, user: req.user._id });
    if (!quiz) return res.status(404).json({ message: "AI quiz not found" });
    if (quiz.isSubmitted) {
      return res.status(400).json({ message: "This AI quiz was already submitted" });
    }

    let correctCount = 0;
    const questionDetails = [];

    for (const ans of answers) {
      const q = (quiz.questions || []).find((qq) => qq.qid === ans.qid);
      if (!q) continue;

      const isCorrect = q.correctOptionIndex === ans.selectedOptionIndex;
      if (isCorrect) correctCount++;

      questionDetails.push({
        question: null,
        selectedOptionIndex: ans.selectedOptionIndex,
        isCorrect,
        source: "AI",
        ai: {
          qid: q.qid,
          questionText: q.questionText,
          options: q.options,
          correctOptionIndex: q.correctOptionIndex,
          explanation: q.explanation || "",
          topic: q.topic || "",
          difficulty: q.difficulty || "Medium",
        },
      });
    }

    const totalQuestions = quiz.limit;
    const incorrectCount = totalQuestions - correctCount;
    const scorePercentage = Math.round((correctCount / totalQuestions) * 100);

    const attempt = await QuizAttempt.create({
      user: req.user._id,
      level: quiz.level,
      subject: quiz.subject,
      topic: "",
      scorePercentage,
      totalQuestions,
      correctCount,
      incorrectCount,
      questions: questionDetails,
      source: "AI",
      aiQuizId: quiz._id,
    });

    quiz.isSubmitted = true;
    await quiz.save();

    const { user, pointsToAdd } = await applyGamification({
      userId: req.user._id,
      scorePercentage,
      totalQuestions,
      subject: quiz.subject,
      attemptId: attempt._id,
    });

    return res.json({
      message: "AI Quiz submitted",
      scorePercentage,
      correctCount,
      incorrectCount,
      totalQuestions,
      pointsEarned: pointsToAdd,
      newTotalPoints: user.points,
      newStreak: user.streak,
      attemptId: attempt._id,
      quizId: quiz._id,
    });
  } catch (error) {
    console.error("submitAIQuiz error:", error.message);
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
  getStreakStatus,

  // AI
  generateAIQuiz,
  getAIQuiz,
  submitAIQuiz,
};
