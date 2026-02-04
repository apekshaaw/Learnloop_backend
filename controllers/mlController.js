// controllers/mlController.js
const ml = require("../services/mlService");
const QuizAttempt = require("../models/QuizAttempt");

/* ----------------------------------------
   Helpers: build real per-user ML context from DB
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

    // personalization hooks
    preferred_learning_time: user?.academicProfile?.preferredLearningTime || null,
    grade: user?.academicProfile?.grade || null,
    faculty: user?.academicProfile?.faculty || null,

    // extra derived fields (your mlService maps these)
    recent_quiz_scores: scores,
    topics_covered_this_week: topics,
    weak_subjects,
  };

  return { payload, scoresCount: scores.length };
}

/* ----------------------------------------
   Normalizers: Flask -> Frontend UI shape
----------------------------------------- */
function normalizePredictPerformance(flaskData) {
  return {
    predicted_score:
      flaskData?.predicted_score ??
      flaskData?.predicted_grade_12 ??
      null,
    confidence: flaskData?.confidence ?? 0,
    improvement_needed: flaskData?.improvement_needed ?? null,
    message: flaskData?.message ?? "Prediction generated",
    _source: "flask",
  };
}

function normalizeRisk(flaskData) {
  // Flask returns recommendations[]; UI expects tips[]
  const tips = Array.isArray(flaskData?.tips)
    ? flaskData.tips
    : Array.isArray(flaskData?.recommendations)
    ? flaskData.recommendations
    : [];

  return {
    risk_level: flaskData?.risk_level ?? "Unknown",
    risk_percentage: flaskData?.risk_percentage ?? flaskData?.risk_percentage ?? null,
    at_risk: typeof flaskData?.at_risk === "boolean" ? flaskData.at_risk : null,
    tips,
    message: flaskData?.message ?? "",
    _source: "flask",
  };
}

function normalizePlan(flaskData) {
  // Flask: best_study_time, weekly_target, focus_area, daily_schedule{}
  // UI: best_study_time, weekly_target, focus, schedule[]
  const ds = flaskData?.daily_schedule || {};

  const schedule = [];

  // weak subjects section
  if (ds?.weak_subjects?.subjects?.length) {
    schedule.push({
      label: "Weak subjects",
      subjects: ds.weak_subjects.subjects,
      time: ds.weak_subjects.time_per_subject,
    });
  }

  if (ds?.strong_subjects?.time) {
    schedule.push({ label: "Strong subjects", time: ds.strong_subjects.time });
  }
  if (ds?.revision) {
    schedule.push({ label: "Revision", time: ds.revision });
  }
  if (ds?.breaks) {
    schedule.push({ label: "Breaks", note: ds.breaks });
  }

  return {
    best_study_time: flaskData?.best_study_time ?? null,
    focus: flaskData?.focus ?? flaskData?.focus_area ?? null,
    weekly_target: flaskData?.weekly_target ?? null,
    schedule,
    anxiety_management: Array.isArray(flaskData?.anxiety_management)
      ? flaskData.anxiety_management
      : [],
    motivational_message: flaskData?.motivational_message ?? "",
    _source: "flask",
  };
}

function normalizeDailyRecommendations(flaskData) {
  // Flask returns: today_recommendations: [{priority, action, description}, ...]
  // UI expects: recommendations: ["...", "..."]
  const items = Array.isArray(flaskData?.today_recommendations)
    ? flaskData.today_recommendations
    : Array.isArray(flaskData?.recommendations)
    ? flaskData.recommendations
    : [];

  const recommendations = items
    .map((r) => {
      if (typeof r === "string") return r;
      const action = r?.action ? String(r.action).trim() : "";
      const desc = r?.description ? String(r.description).trim() : "";
      if (!action && !desc) return null;
      return desc ? `${action} — ${desc}` : action;
    })
    .filter(Boolean);

  return {
    recommendations,
    performance_summary: flaskData?.performance_summary ?? null,
    quote: flaskData?.motivational_quote ?? null,
    date: flaskData?.date ?? null,
    _source: "flask",
  };
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

    // new user fallback
    if (scoresCount < 1) {
      return res.json({
        predicted_score: null,
        confidence: 0,
        message:
          "Not enough quiz data yet. Complete a few quizzes to unlock prediction.",
        _fallback: true,
      });
    }

    const flaskData = await ml.predictPerformance(payload);
    return res.json(normalizePredictPerformance(flaskData));
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

    const flaskData = await ml.checkRisk(payload);
    return res.json(normalizeRisk(flaskData));
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

    const flaskData = await ml.personalizedPlan(payload);
    return res.json(normalizePlan(flaskData));
  } catch (e) {
    next(e);
  }
};

exports.gamificationStatus = async (req, res, next) => {
  try {
    const studentId = req.query.student_id;
    if (!studentId) {
      return res.status(400).json({ message: "student_id is required" });
    }

    try {
      const data = await ml.gamificationStatus(studentId);
      return res.json(data);
    } catch (e) {
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

    const flaskData = await ml.dailyRecommendations(payload);
    return res.json(normalizeDailyRecommendations(flaskData));
  } catch (e) {
    next(e);
  }
};
