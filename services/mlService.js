const axios = require("axios");

const AI_BASE = process.env.AI_SERVICE_URL || "http://localhost:5001";


async function callAI(path, payload = null, method = "post") {
  try {
    const url = `${AI_BASE}${path}`;

    const res =
      method === "get"
        ? await axios.get(url, { params: payload || {} })
        : await axios.post(url, payload || {});

    return res.data;
  } catch (err) {
    const status = err?.response?.status || 500;
    const data = err?.response?.data || null;
    const msg = err?.response?.data?.error || err?.message || "AI service error";

    const e = new Error(msg);
    e.status = status;
    e.data = data;
    throw e;
  }
}


function clampNum(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.min(max, Math.max(min, x));
}

function resolveStudentId(payload) {

  return (
    payload?.student_id ||
    payload?.studentId ||
    payload?._id?.toString?.() ||
    payload?.id ||
    payload?.userId ||
    null
  );
}

function extractRecentScores(lastAttempts) {
  if (!Array.isArray(lastAttempts)) return [];
  return lastAttempts
    .map((a) => a?.scorePercentage)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n))
    .slice(0, 12);
}

function extractTopics(lastAttempts) {
  if (!Array.isArray(lastAttempts)) return [];
  const seen = new Set();
  const topics = [];
  for (const a of lastAttempts) {
    const subj = (a?.subject || "").trim();
    if (!subj) continue;
    if (!seen.has(subj)) {
      seen.add(subj);
      topics.push(subj);
    }
    if (topics.length >= 8) break;
  }
  return topics;
}

function inferWeakSubjects(lastAttempts) {
  if (!Array.isArray(lastAttempts) || lastAttempts.length === 0) return [];

  const agg = new Map(); 
  for (const a of lastAttempts) {
    const subject = (a?.subject || "").trim();
    const score = Number(a?.scorePercentage);
    if (!subject || !Number.isFinite(score)) continue;
    const cur = agg.get(subject) || { sum: 0, count: 0 };
    cur.sum += score;
    cur.count += 1;
    agg.set(subject, cur);
  }

  const avgs = [...agg.entries()]
    .map(([subject, v]) => ({ subject, avg: v.sum / Math.max(1, v.count) }))
    .sort((a, b) => a.avg - b.avg);

  const weak = [];
  for (const x of avgs) {
    if (x.avg < 65) weak.push(x.subject);
    if (weak.length >= 3) break;
  }

  return weak;
}

function normalizeTimeSlot(v, fallback = "Morning") {
  if (!v) return fallback;
  const s = String(v).trim().toLowerCase();

  if (s.includes("morn")) return "Morning";
  if (s.includes("after")) return "Afternoon";
  if (s.includes("even")) return "Evening";
  if (s.includes("night")) return "Night";

  if (["morning", "afternoon", "evening", "night"].includes(s)) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return fallback;
}

function normalizeLevel(v, fallback = "Medium") {
  if (!v) return fallback;
  const s = String(v).trim().toLowerCase();
  if (s === "low") return "Low";
  if (s === "high") return "High";
  return "Medium";
}

function mapDashboardPayloadToFlaskInput(body = {}) {
  const student_id = resolveStudentId(body);

  const attempts =
    Array.isArray(body?.lastAttempts) ? body.lastAttempts :
    Array.isArray(body?.recent_attempts) ? body.recent_attempts :
    Array.isArray(body?.recentAttempts) ? body.recentAttempts :
    [];

  const recentScores = extractRecentScores(attempts);
  const recentAvg =
    recentScores.length > 0
      ? recentScores.reduce((a, b) => a + b, 0) / recentScores.length
      : null;

  const baseFallback =
    typeof body?.academicProfile?.grade === "string" && body.academicProfile.grade === "12"
      ? 68
      : 72;

  const grade_11_percentage =
    clampNum(body?.grade_11_percentage, 0, 100) ??
    clampNum(body?.grade11Percentage, 0, 100) ??
    clampNum(body?.avgScore, 0, 100) ??
    (recentAvg != null ? Math.round(recentAvg) : baseFallback);

  const streak = Number(body?.streak ?? 0);
  const points = Number(body?.points ?? 0);

  const attendance_rate =
    clampNum(body?.attendance_rate, 0, 100) ??
    clampNum(body?.attendanceRate, 0, 100) ??
    clampNum(body?.attendance, 0, 100) ??
    (streak >= 7 ? 90 : streak >= 3 ? 85 : 80);

  const study_hours_per_day =
    clampNum(body?.study_hours_per_day, 0, 16) ??
    clampNum(body?.studyHoursPerDay, 0, 16) ??
    clampNum(body?.studyHours, 0, 16) ??
    (streak >= 7 ? 3.5 : streak >= 3 ? 3 : 2.5);

  const preferred_learning_time = normalizeTimeSlot(
    body?.preferred_learning_time ?? body?.preferredLearningTime,
    "Morning"
  );

  const motivation_level = normalizeLevel(
    body?.motivation_level ?? body?.motivationLevel,
    streak >= 5 ? "High" : "Medium"
  );

  const exam_anxiety_level = normalizeLevel(
    body?.exam_anxiety_level ?? body?.examAnxietyLevel,
    grade_11_percentage < 55 ? "High" : "Medium"
  );

  const weak_subjects =
    Array.isArray(body?.weak_subjects) && body.weak_subjects.length
      ? body.weak_subjects
      : Array.isArray(body?.weakSubjects) && body.weakSubjects.length
      ? body.weakSubjects
      : inferWeakSubjects(attempts);

  const topics_covered_this_week = extractTopics(attempts);

  const grade = body?.academicProfile?.grade ?? body?.grade ?? null;
  const faculty = body?.academicProfile?.faculty ?? body?.faculty ?? null;

  return {
    student_id,
    grade_11_percentage,
    attendance_rate,
    study_hours_per_day,
    motivation_level,
    exam_anxiety_level,
    weak_subjects,
    recent_quiz_scores: recentScores,
    topics_covered_this_week,
    preferred_learning_time,
    grade,
    faculty,
    streak,
    points,
  };
}

function ensureFlaskInput(body) {
  const mapped = mapDashboardPayloadToFlaskInput(body || {});
  if (!body || typeof body !== "object") return mapped;

  return { ...mapped, ...body };
}


module.exports = {
  health: () => callAI("/health", null, "get"),

  predictPerformance: (body) => callAI("/predict-performance", ensureFlaskInput(body)),

  checkRisk: (body) => callAI("/check-risk", ensureFlaskInput(body)),

  personalizedPlan: (body) => callAI("/personalized-plan", ensureFlaskInput(body)),

  gamificationStatus: (student_id) => callAI("/gamification-status", { student_id }, "get"),

  dailyRecommendations: (body) => callAI("/daily-recommendations", ensureFlaskInput(body)),
};
