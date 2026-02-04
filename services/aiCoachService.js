const User = require("../models/User");
const QuizAttempt = require("../models/QuizAttempt");
const { generateJSON } = require("./geminiService"); 


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

const ALLOWED_LIMITS = [5, 10, 15];

const pickLimit = ({ weaknessScore, atRiskStreakSave }) => {
  if (atRiskStreakSave) return 5;
  if (weaknessScore <= 55) return 15;
  if (weaknessScore <= 70) return 10;
  return 5;
};

const normalizeGradeToLevel = (grade) => {
  const g = String(grade || "").trim();
  if (g === "12" || g.toLowerCase().includes("12")) return "Class 12";
  return "Class 11";
};

const summarizeSubjects = (subjects) => {
  if (!subjects || subjects.length === 0) return "No quiz data yet.";
  const sorted = [...subjects].sort((a, b) => a.avgScore - b.avgScore);
  const weak = sorted[0];
  const strong = sorted[sorted.length - 1];
  return `Weakest: ${weak.subject} (${weak.avgScore}%). Strongest: ${strong.subject} (${strong.avgScore}%).`;
};

const isAskingPlan = (text) => {
  const t = (text || "").toLowerCase();
  return (
    t.includes("7-day") ||
    t.includes("7 day") ||
    t.includes("seven") ||
    t.includes("plan") ||
    t.includes("schedule") ||
    t.includes("routine")
  );
};

const isAskingWeakness = (text) => {
  const t = (text || "").toLowerCase();
  return (
    t.includes("weak") ||
    t.includes("weakness") ||
    t.includes("fix mode") ||
    t.includes("improve") ||
    t.includes("struggling") ||
    t.includes("focus")
  );
};

const isAskingStreak = (text) => {
  const t = (text || "").toLowerCase();
  return (
    t.includes("streak") ||
    t.includes("motivate") ||
    t.includes("remind") ||
    t.includes("lazy") ||
    t.includes("procrast") ||
    t.includes("i don't feel") ||
    t.includes("tired")
  );
};

const isAskingTutor = (text) => {
  const t = (text || "").toLowerCase().trim();
  return (
    t.startsWith("teach me") ||
    t.startsWith("teach ") ||
    t.startsWith("explain ") ||
    t.includes("help me learn") ||
    t.includes("teach me")
  );
};

const extractTutorTopic = (text) => {
  const raw = String(text || "").trim();
  const lower = raw.toLowerCase();

  const i1 = lower.indexOf("teach me");
  if (i1 !== -1) {
    const after = raw.slice(i1 + "teach me".length).trim();
    if (after) return after.replace(/^[\:\-\s]+/, "").trim();
  }

  const i2 = lower.indexOf("explain");
  if (i2 !== -1) {
    const after = raw.slice(i2 + "explain".length).trim();
    if (after) return after.replace(/^[\:\-\s]+/, "").trim();
  }

  return "the topic";
};

const extractSubjectHint = (text) => {
  const t = (text || "").toLowerCase();
  const subjects = [
    "physics",
    "chemistry",
    "mathematics",
    "math",
    "biology",
    "computer science",
    "accounting",
    "economics",
    "business studies",
    "english",
  ];

  for (const s of subjects) {
    if (t.includes(s)) {
      if (s === "math") return "Mathematics";
      return s
        .split(" ")
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join(" ");
    }
  }
  return null;
};

const makeDay = (day, title, focus, quiz) => ({
  day,
  title,
  focus,
  tasks: [
    `Concept: ${focus.concept}`,
    `Practice: ${focus.practice}`,
    `Revision: ${focus.revision}`,
  ],
  quiz,
});


const getProgressStats = async (userId) => {
  const attempts = await QuizAttempt.find({ user: userId })
    .sort({ createdAt: -1 })
    .select("subject level scorePercentage totalQuestions createdAt source")
    .lean();

  const totalQuizzes = attempts.length;

  const avgScore =
    totalQuizzes === 0
      ? 0
      : Math.round(
          attempts.reduce((sum, a) => sum + (a.scorePercentage || 0), 0) /
            totalQuizzes
        );

  const subjectMap = new Map();
  for (const a of attempts) {
    const key = a.subject || "Unknown";
    const cur = subjectMap.get(key) || { total: 0, count: 0 };
    cur.total += a.scorePercentage || 0;
    cur.count += 1;
    subjectMap.set(key, cur);
  }

  const subjects = Array.from(subjectMap.entries()).map(([subject, v]) => ({
    subject,
    avgScore: Math.round(v.total / v.count),
    count: v.count,
  }));

  let weakestSubject = null;
  let weakestScore = 0;

  if (subjects.length > 0) {
    const sorted = [...subjects].sort((a, b) => a.avgScore - b.avgScore);
    weakestSubject = sorted[0].subject;
    weakestScore = sorted[0].avgScore;
  }

  return {
    totalQuizzes,
    avgScore,
    subjects: subjects.map((s) => ({ subject: s.subject, avgScore: s.avgScore })),
    weakestSubject,
    weakestScore,
    recentAttempts: attempts.slice(0, 5),
  };
};


const buildSevenDayPlan = ({ level, faculty, scienceStream, weakestSubject }) => {
  const defaultByFaculty = () => {
    if (faculty === "Science") {
      if (scienceStream === "Biology") return ["Physics", "Chemistry", "Biology", "Mathematics"];
      if (scienceStream === "Computer Science") return ["Physics", "Chemistry", "Computer Science", "Mathematics"];
      return ["Physics", "Chemistry", "Mathematics"];
    }
    if (faculty === "Management") return ["Accounting", "Economics", "Business Studies", "Mathematics"];
    return ["English", "Mathematics"];
  };

  const pool = defaultByFaculty();
  const weak = weakestSubject && pool.includes(weakestSubject) ? weakestSubject : pool[0];

  return [
    makeDay(1, "Start + diagnose", { concept: `${weak} fundamentals`, practice: "10 mixed questions", revision: "30-min recap notes" }, { subject: weak, level, limit: 10 }),
    makeDay(2, "Strengthen basics", { concept: `${weak} key formulas / core ideas`, practice: "worked examples", revision: "mistake list update" }, { subject: weak, level, limit: 10 }),
    makeDay(3, "Practice under time", { concept: `${weak} common exam patterns`, practice: "timed practice set", revision: "flash review" }, { subject: weak, level, limit: 15 }),
    makeDay(4, "Second subject rotation", { concept: `${pool[1] || weak} core chapter`, practice: "concept + 8 Q", revision: "quick notes" }, { subject: pool[1] || weak, level, limit: 10 }),
    makeDay(5, "Mixed practice day", { concept: "weak + strong mix", practice: "mixed set", revision: "review mistakes" }, { subject: weak, level, limit: 15 }),
    makeDay(6, "Mock-style day", { concept: "speed + accuracy", practice: "timed quiz + review", revision: "summary sheet" }, { subject: pool[2] || weak, level, limit: 10 }),
    makeDay(7, "Weekly review + reset", { concept: "full recap", practice: "retest weakest topics", revision: "plan next week" }, { subject: weak, level, limit: 10 }),
  ];
};


const buildWeaknessFix = ({ weakestSubject, weakestScore, level, streakAtRisk }) => {
  const limit = pickLimit({ weaknessScore: weakestScore || 0, atRiskStreakSave: streakAtRisk });

  const topics =
    weakestSubject
      ? [
          `${weakestSubject}: Fundamentals first`,
          `${weakestSubject}: Past-paper patterns`,
          `${weakestSubject}: Timed practice + review`,
        ]
      : ["Start with basics", "Then move to exam patterns", "Finish with timed practice"];

  return {
    weakestSubject: weakestSubject || "Not enough data yet",
    plan: {
      priorityTopics: topics,
      dailyQuiz: {
        subject: weakestSubject || "Choose any subject",
        level,
        limit,
        reason: streakAtRisk
          ? "Streak is at risk, do a quick 5-question quiz to save it."
          : weakestScore <= 55
          ? "You’re quite weak here, 15 questions builds endurance + accuracy."
          : weakestScore <= 70
          ? "10 questions daily is perfect for steady improvement."
          : "Short 5-question quizzes keep consistency high.",
      },
      rule: "Do the quiz first, then study (you’ll notice mistakes faster).",
    },
  };
};


const buildMotivation = ({ streak, lastActiveDate }) => {
  const s = streak || 0;
  const now = new Date();

  let daysSince = null;
  if (lastActiveDate) daysSince = daysBetween(now, new Date(lastActiveDate));

  const atRisk = daysSince === 2 && s > 0;

  const prompt =
    s >= 7
      ? `You’ve built a ${s}-day streak. Don’t break it now, do one quick quiz and lock today in.`
      : s >= 3
      ? `Streak: ${s} days. You’re building momentum, do a short quiz today to keep it alive.`
      : s > 0
      ? `Streak: ${s} day(s). Let’s make it 2, one quiz now, then stop.`
      : `Start small: do a 5-question quiz today. Consistency beats motivation.`;

  const streakReminder = atRisk
    ? "⚠️ Your streak is at risk. Do a 5-question quiz now to save it."
    : daysSince === 1 && s > 0
    ? "You were active yesterday, keep it going with a short quiz."
    : null;

  return { prompt, streakReminder, atRisk };
};


const recommendQuiz = ({ level, progress, streakInfo, message, faculty, scienceStream }) => {
  const subjectHint = extractSubjectHint(message);

  const fallbackPool = (() => {
    if (faculty === "Science") {
      if (scienceStream === "Biology") return ["Physics", "Chemistry", "Biology", "Mathematics"];
      if (scienceStream === "Computer Science") return ["Physics", "Chemistry", "Computer Science", "Mathematics"];
      return ["Physics", "Chemistry", "Mathematics"];
    }
    if (faculty === "Management") return ["Accounting", "Economics", "Business Studies", "Mathematics"];
    return ["English", "Mathematics"];
  })();

  const subject = subjectHint || progress.weakestSubject || fallbackPool[0];
  const weaknessScore = progress.weakestSubject === subject ? progress.weakestScore : 70;

  const limit = pickLimit({
    weaknessScore,
    atRiskStreakSave: streakInfo.atRisk,
  });

  const reason =
    streakInfo.atRisk
      ? "Your streak is at risk, a quick 5-question quiz saves it."
      : progress.weakestSubject === subject
      ? `You’re weakest in ${subject}. Do ${limit} questions there now to improve faster.`
      : `This matches what you’re asking. Do ${limit} questions to reinforce it.`;

  return { subject, level, limit, reason };
};


const safeString = (v, fallback = "") => (typeof v === "string" ? v : fallback);

const sanitizeSevenDayPlan = ({ planFromAI, fallbackPlan, level }) => {
  if (!Array.isArray(planFromAI)) return fallbackPlan;

  const byDay = new Map();
  for (const item of planFromAI) {
    const dayNum = Number(item?.day);
    if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 7) continue;

    const title = safeString(item?.title, fallbackPlan[dayNum - 1]?.title || `Day ${dayNum}`);
    const tasks = Array.isArray(item?.tasks) ? item.tasks.map((t) => safeString(t)).filter(Boolean) : null;

    const quizIn = item?.quiz || {};
    const fallbackQuiz = fallbackPlan[dayNum - 1]?.quiz || { subject: "Mathematics", level, limit: 10 };

    const subject = safeString(quizIn?.subject, fallbackQuiz.subject);
    const qLevel = safeString(quizIn?.level, fallbackQuiz.level);
    const limit = ALLOWED_LIMITS.includes(Number(quizIn?.limit)) ? Number(quizIn.limit) : fallbackQuiz.limit;

    byDay.set(dayNum, {
      day: dayNum,
      title,
      tasks: tasks && tasks.length ? tasks.slice(0, 6) : fallbackPlan[dayNum - 1]?.tasks || [],
      quiz: { subject, level: qLevel, limit },
    });
  }

  const final = [];
  for (let d = 1; d <= 7; d++) {
    final.push(byDay.get(d) || fallbackPlan[d - 1]);
  }
  return final;
};

const systemCoach = `You are LearnLoop AI Coach for Nepal +2 students.
Return ONLY valid JSON (no markdown) matching the schema we request.
Be clear, helpful, not robotic.`;

const systemTutor = `You are a patient tutor.
Return ONLY valid JSON (no markdown) matching the schema we request.
Teach step-by-step: explanation -> worked examples -> practice questions -> ask student to reply.`;

const systemPlan = `You create a 7-day study plan for Nepal +2 students.
Return ONLY valid JSON (no markdown) matching the schema we request.
Plan must be realistic, short, actionable. Use the student's weakest subject more.`;

const buildUserContext = ({ userName, level, faculty, scienceStream, progressLine, streakInfo, message }) => {
  return `Student:
- Name: ${userName || "Student"}
- Level: ${level}
- Faculty: ${faculty}${scienceStream ? ` (${scienceStream})` : ""}

Quiz progress summary:
- ${progressLine}

Streak:
- streakDays: ${streakInfo?.streakDays ?? "unknown"}
- atRisk: ${streakInfo?.atRisk ? "yes" : "no"}
- reminder: ${streakInfo?.streakReminder || "none"}

User message:
"${message}"`;
};


exports.coach = async ({ userId, message = "", mode = "auto" }) => {
  if (!userId) {
    return {
      data: {
        reply: "You must be logged in to use AI Coach.",
        motivation: { prompt: "", streakReminder: null },
        recommendedQuiz: null,
        sevenDayPlan: [],
      },
    };
  }

  const user = await User.findById(userId)
    .select("name email academicProfile streak lastActiveDate points")
    .lean();

  const academic = user?.academicProfile || {};
  const level = normalizeGradeToLevel(academic.grade);
  const faculty = academic.faculty || "Science";
  const scienceStream = academic.scienceStream || "";

  const progress = await getProgressStats(userId);

  const motivationRaw = buildMotivation({
    streak: user?.streak,
    lastActiveDate: user?.lastActiveDate,
  });

  const streakInfo = {
    prompt: motivationRaw.prompt,
    streakReminder: motivationRaw.streakReminder,
    atRisk: motivationRaw.atRisk,
    streakDays: user?.streak || 0,
  };

  const autoTutor = isAskingTutor(message);
  const autoPlan = isAskingPlan(message);
  const autoWeakness = isAskingWeakness(message);
  const autoStreak = isAskingStreak(message);

  const effectiveMode =
    mode !== "auto"
      ? mode
      : autoTutor
      ? "tutor"
      : autoPlan
      ? "plan"
      : autoWeakness
      ? "weakness"
      : autoStreak
      ? "streak"
      : "recommend";

  const rec = recommendQuiz({
    level,
    progress,
    streakInfo,
    message,
    faculty,
    scienceStream,
  });

  const fallbackPlan = buildSevenDayPlan({
    level,
    faculty,
    scienceStream,
    weakestSubject: progress.weakestSubject,
  });

  const weaknessFix =
    effectiveMode === "weakness"
      ? buildWeaknessFix({
          weakestSubject: progress.weakestSubject,
          weakestScore: progress.weakestScore,
          level,
          streakAtRisk: streakInfo.atRisk,
        })
      : null;

  const progressLine = summarizeSubjects(progress.subjects);

  let reply = "";
  let sevenDayPlan = effectiveMode === "plan" || effectiveMode === "recommend" ? fallbackPlan : [];

  try {
    if (effectiveMode === "tutor") {
      const topic = extractTutorTopic(message);

      const userPrompt = buildUserContext({
        userName: user?.name,
        level,
        faculty,
        scienceStream,
        progressLine,
        streakInfo,
        message,
      });

      const ai = await generateJSON({
        system: systemTutor,
        user: `${userPrompt}

JSON schema:
{
  "reply": "string (teaching content: explanation + 2-3 worked examples + 5 practice questions + ask student to reply)"
}

Now teach: ${topic}`,
      });

      reply = safeString(ai?.reply, "");
      if (!reply) throw new Error("Gemini returned empty tutor reply");

      return {
        data: {
          reply,
          mode: effectiveMode,
          motivation: {
            prompt: streakInfo.prompt,
            streakReminder: streakInfo.streakReminder,
            streak: user?.streak || 0,
            lastActiveDate: user?.lastActiveDate || null,
          },
          progress: {
            totalQuizzes: progress.totalQuizzes,
            avgScore: progress.avgScore,
            weakestSubject: progress.weakestSubject,
            weakestScore: progress.weakestScore,
            subjects: progress.subjects,
          },
          weaknessFix,
          recommendedQuiz: null,
          sevenDayPlan: [],
        },
      };
    }

    if (effectiveMode === "plan") {
      const userPrompt = buildUserContext({
        userName: user?.name,
        level,
        faculty,
        scienceStream,
        progressLine,
        streakInfo,
        message,
      });

      const ai = await generateJSON({
        system: systemPlan,
        user: `${userPrompt}

JSON schema:
{
  "reply": "string (short intro + how to follow the plan)",
  "sevenDayPlan": [
    { "day": 1, "title": "string", "tasks": ["string","string","string"], "quiz": { "subject":"string", "level":"${level}", "limit": 5|10|15 } },
    ...
    { "day": 7, "title": "string", "tasks": ["string","string","string"], "quiz": { "subject":"string", "level":"${level}", "limit": 5|10|15 } }
  ]
}

Rules:
- Must return exactly 7 days.
- tasks must be real and specific.
- Use weakest subject more in days 1-3.

Now generate the plan.`,
      });

      reply = safeString(ai?.reply, "");
      sevenDayPlan = sanitizeSevenDayPlan({
        planFromAI: ai?.sevenDayPlan,
        fallbackPlan,
        level,
      });

      if (!reply) {
        reply = `Here’s your 7-day plan for ${level} (${faculty}${scienceStream ? ` • ${scienceStream}` : ""}). I used your quiz history: ${progressLine}`;
      }

      return {
        data: {
          reply,
          mode: effectiveMode,
          motivation: {
            prompt: streakInfo.prompt,
            streakReminder: streakInfo.streakReminder,
            streak: user?.streak || 0,
            lastActiveDate: user?.lastActiveDate || null,
          },
          progress: {
            totalQuizzes: progress.totalQuizzes,
            avgScore: progress.avgScore,
            weakestSubject: progress.weakestSubject,
            weakestScore: progress.weakestScore,
            subjects: progress.subjects,
          },
          weaknessFix,
          recommendedQuiz: rec,
          sevenDayPlan,
        },
      };
    }

    if (effectiveMode === "recommend" || effectiveMode === "coach") {
      const userPrompt = buildUserContext({
        userName: user?.name,
        level,
        faculty,
        scienceStream,
        progressLine,
        streakInfo,
        message,
      });

      const ai = await generateJSON({
        system: systemCoach,
        user: `${userPrompt}

JSON schema:
{
  "reply": "string (ChatGPT-like helpful answer). Must be direct and actually answer the user.",
  "optionalMiniLesson": "string (optional)"
}

If user asks to learn/teach a topic, include a short mini-lesson inside reply.
If user asks for a plan, tell them the plan is shown on the right and what to do first today.
Now respond.`,
      });

      reply = safeString(ai?.reply, "");
      if (!reply) throw new Error("Gemini returned empty coach reply");

      return {
        data: {
          reply,
          mode: effectiveMode,
          motivation: {
            prompt: streakInfo.prompt,
            streakReminder: streakInfo.streakReminder,
            streak: user?.streak || 0,
            lastActiveDate: user?.lastActiveDate || null,
          },
          progress: {
            totalQuizzes: progress.totalQuizzes,
            avgScore: progress.avgScore,
            weakestSubject: progress.weakestSubject,
            weakestScore: progress.weakestScore,
            subjects: progress.subjects,
          },
          weaknessFix,
          recommendedQuiz: rec,
          sevenDayPlan: fallbackPlan,
        },
      };
    }
  } catch (err) {
    if (effectiveMode === "plan") {
      reply = `Here’s your 7-day plan for ${level} (${faculty}${scienceStream ? ` • ${scienceStream}` : ""}). I used your quiz history: ${progressLine} Start with Day 1 today.`;
      sevenDayPlan = fallbackPlan;
    } else if (effectiveMode === "weakness") {
      reply = `Weakness Fix Mode ON. Based on your progress, focus on **${progress.weakestSubject || "your weakest subject"}** first. Do the quiz first, then study.`;
    } else if (effectiveMode === "streak") {
      reply = streakInfo.prompt;
    } else if (effectiveMode === "tutor") {
      reply = `Tutor mode failed (Gemini). Check GEMINI_API_KEY and server logs.`;
    } else {
      reply = `AI Coach failed (Gemini). Check backend logs + GEMINI_API_KEY.`;
    }
  }

  return {
    data: {
      reply,
      mode: effectiveMode,

      motivation: {
        prompt: streakInfo.prompt,
        streakReminder: streakInfo.streakReminder,
        streak: user?.streak || 0,
        lastActiveDate: user?.lastActiveDate || null,
      },

      progress: {
        totalQuizzes: progress.totalQuizzes,
        avgScore: progress.avgScore,
        weakestSubject: progress.weakestSubject,
        weakestScore: progress.weakestScore,
        subjects: progress.subjects,
      },

      weaknessFix,

      recommendedQuiz: effectiveMode === "tutor" ? null : rec,

      sevenDayPlan,
    },
  };
};
