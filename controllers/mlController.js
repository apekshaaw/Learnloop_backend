const ml = require("../services/mlService");
const QuizAttempt = require("../models/QuizAttempt");

/* ----------------------------------------
   Helpers (NEW): build real per-user ML context from DB
----------------------------------------- */
function avg(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function uniqueTopicsFromAttempts(attempts, max = 8) {
  const seen = new Set();
  const topics = [];
  for (const a of attempts) {
    const t = String(a.subject || "").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    topics.push(t);
    if (topics.length >= max) break;
  }
  return topics;
}

function weakSubjectsFromAttempts(attempts) {
  // avg score per subject, return up to 3 weakest
  const agg = new Map(); // subject -> {sum,count}
  for (const a of attempts) {
    const subject = String(a.subject || "").trim();
    const score = Number(a.scorePercentage);
    if (!subject || !Number.isFinite(score)) continue;
    const cur = agg.get(subject) || { sum: 0, count: 0 };
    cur.sum += score;
    cur.count += 1;
    agg.set(subject, cur);
  }

  const avgs = [...agg.entries()]
    .map(([subject, v]) => ({ subject, avg: v.sum / Math.max(1, v.count) }))
    .sort((a, b) => a.avg - b.avg);

  return avgs.slice(0, 3).map((x) => x.subject);
}

function buildGamificationFallback(user, studentId) {
  const points = user?.points ?? 0;
  const streak = user?.streak ?? 0;

  const level =
    typeof user?.calculateGameLevel === "function"
      ? user.calculateGameLevel()
      : Math.floor((points || 0) / 500) + 1;

  const progressToNext = Math.round((((points || 0) % 500) / 500) * 100);

  return {
    student_id: studentId,
    level,
    total_points: points,
    badges_earned: user?.badgesEarned ?? 0,
    streak_days: streak,
    leaderboard_rank: null,
    next_level_in: (level + 1) * 500 - (points || 0),
    progress_to_next_level: progressToNext,
    achievements: [
      `🏆 Level ${level} Champion`,
      `🔥 ${streak}-Day Streak`,
      `⭐ ${(user?.badgesEarned ?? 0)} Badges Collected`,
    ],
    _fallback: true,
  };
}

// ✅ IMPORTANT: if attempts are too few, return a realistic "not enough data yet"
function buildMLPayloadFromDB({ user, attempts }) {
  const scores = attempts
    .map((a) => Number(a.scorePercentage))
    .filter((n) => Number.isFinite(n))
    .slice(0, 12);

  const topics = uniqueTopicsFromAttempts(attempts);
  const weak_subjects = weakSubjectsFromAttempts(attempts);

  const recentAvg = avg(scores);

  // ✅ this is what makes outputs DIFFERENT per user
  const payload = {
    student_id: String(user._id),
    lastAttempts: attempts.map((a) => ({
      subject: a.subject,
      scorePercentage: a.scorePercentage,
      createdAt: a.createdAt,
    })),

    // helpful signals
    streak: user.streak || 0,
    points: user.points || 0,
    avgScore: recentAvg != null ? Math.round(recentAvg) : null,

    // personalization hooks (even if Flask ignores now, it’s good to send)
    preferred_learning_time: user?.academicProfile?.preferredLearningTime || null,
    grade: user?.academicProfile?.grade || null,
    faculty: user?.academicProfile?.faculty || null,

    // extra derived fields (your mlService can map these)
    recent_quiz_scores: scores,
    topics_covered_this_week: topics,
    weak_subjects,
  };

  return { payload, scoresCount: scores.length };
}

/* ----------------------------------------
   Controllers
----------------------------------------- */

exports.aiHealth = async (req, res, next) => {
  try {
    const data = await ml.health();
    res.json(data);
  } catch (e) {
    next(e);
  }
};

exports.predictPerformance = async (req, res, next) => {
  try {
    if (!req.user?._id) return res.status(401).json({ message: "Unauthorized" });

    const recentAttempts = await QuizAttempt.find({ user: req.user._id })
      .sort("-createdAt")
      .limit(12)
      .select("subject scorePercentage createdAt");

    const { payload, scoresCount } = buildMLPayloadFromDB({
      user: req.user,
      attempts: recentAttempts,
    });

    // ✅ if user is new, don’t pretend AI knows them
    if (scoresCount < 1) {
      return res.json({
        predicted_score: null,
        confidence: 0,
        message: "Not enough quiz data yet. Complete a few quizzes to unlock prediction.",
        _fallback: true,
      });
    }

    const data = await ml.predictPerformance(payload);
    return res.json(data);
  } catch (e) {
    next(e);
  }
};



exports.checkRisk = async (req, res, next) => {
  try {
    if (!req.user?._id) return res.status(401).json({ message: "Unauthorized" });

    const recentAttempts = await QuizAttempt.find({ user: req.user._id })
      .sort("-createdAt")
      .limit(12)
      .select("subject scorePercentage createdAt");

    const { payload, scoresCount } = buildMLPayloadFromDB({
      user: req.user,
      attempts: recentAttempts,
    });

    if (scoresCount < 1) {
      return res.json({
        risk_level: "Unknown",
        message: "Not enough quiz data yet. Take a few quizzes to calculate risk.",
        tips: ["Start with 1 short quiz today", "Focus on basics first"],
        _fallback: true,
      });
    }

    const data = await ml.checkRisk(payload);
    return res.json(data);
  } catch (e) {
    next(e);
  }
};




exports.personalizedPlan = async (req, res, next) => {
  try {
    if (!req.user?._id) return res.status(401).json({ message: "Unauthorized" });

    const recentAttempts = await QuizAttempt.find({ user: req.user._id })
      .sort("-createdAt")
      .limit(12)
      .select("subject scorePercentage createdAt");

    const { payload, scoresCount } = buildMLPayloadFromDB({
      user: req.user,
      attempts: recentAttempts,
    });

    if (scoresCount < 1) {
      const pref = payload.preferred_learning_time || "Evening";
      return res.json({
        best_study_time: pref,
        focus: "Build fundamentals",
        weekly_target: "Complete 10–15 practice questions",
        weak_subjects: [],
        schedule: [
          { label: "Strong subjects", hours: 0.5 },
          { label: "Revision", hours: 0.25 },
          { label: "Breaks", note: "10 min every hour" },
        ],
        message: "Do a few quizzes to generate a fully personalized plan.",
        _fallback: true,
      });
    }

    const data = await ml.personalizedPlan(payload);
    return res.json(data);
  } catch (e) {
    next(e);
  }
};



exports.gamificationStatus = async (req, res, next) => {
  try {
    const studentId = req.query.student_id;
    if (!studentId) return res.status(400).json({ message: "student_id is required" });

    try {
      const data = await ml.gamificationStatus(studentId);
      return res.json(data);
    } catch (e) {
      // If Flask returns 404 Student not found, do NOT break dashboard
      const status = e?.status || e?.response?.status;
      if (status === 404) {
        return res.json(buildGamificationFallback(req.user, studentId));
      }
      throw e;
    }
  } catch (e) {
    next(e);
  }
};

exports.dailyRecommendations = async (req, res, next) => {
  try {
    if (!req.user?._id) return res.status(401).json({ message: "Unauthorized" });

    const recentAttempts = await QuizAttempt.find({ user: req.user._id })
      .sort("-createdAt")
      .limit(12)
      .select("subject scorePercentage createdAt");

    const { payload, scoresCount } = buildMLPayloadFromDB({
      user: req.user,
      attempts: recentAttempts,
    });

    if (scoresCount < 1) {
      return res.json({
        recommendations: [
          "Take 1 quick quiz (5–10 mins)",
          "Review 1 weak area after the quiz",
          "Do 10 minutes of revision",
        ],
        gamification: "Active",
        message: "Complete a few quizzes to unlock personalized recommendations.",
        _fallback: true,
      });
    }

    const data = await ml.dailyRecommendations(payload);
    return res.json(data);
  } catch (e) {
    next(e);
  }
};


