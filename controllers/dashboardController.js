const QuizAttempt = require("../models/QuizAttempt");
const User = require("../models/User");
const aiService = require("../services/aiService");

// GET /api/dashboard/summary (protected)
exports.getDashboardSummary = async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // If not onboarded, frontend should redirect to onboarding
    if (!user.onboardingCompleted) {
      return res.json({
        needsOnboarding: true,
        user: { name: user.name, onboardingCompleted: false },
      });
    }

    // 1) Compute weak areas from attempts (MVP)
    const weakAreasAgg = await QuizAttempt.aggregate([
      { $match: { user: userId } },
      {
        $group: {
          _id: { subject: "$subject", topic: "$topic" },
          avgScore: { $avg: "$scorePercentage" },
          count: { $sum: 1 },
        },
      },
      { $sort: { avgScore: 1, count: -1 } },
      { $limit: 5 },
    ]);

    const weakAreas = weakAreasAgg.map((w) => ({
      subject: w._id.subject,
      topic: w._id.topic || "General",
      score: Math.round(w.avgScore),
      attempts: w.count,
    }));

    // 2) Recent attempts snapshot for AI (optional)
    const recentAttempts = await QuizAttempt.find({ user: userId })
      .sort("-createdAt")
      .limit(10)
      .select("subject topic scorePercentage createdAt");

    // 3) Try AI recommendations, fallback if AI not available
    let todayRecommendations = [];
    try {
      const aiRec = await aiService.getDailyRecommendations({
        student_id: user.studentId,
        faculty: user.faculty,
        class_level: user.level,
        recent_attempts: recentAttempts.map((a) => ({
          subject: a.subject,
          topic: a.topic,
          score: a.scorePercentage,
        })),
        weak_areas: weakAreas,
      });

      // Expecting AI to return a list; if not, fallback
      if (Array.isArray(aiRec?.recommendations)) {
        todayRecommendations = aiRec.recommendations;
      }
    } catch (_) {}

    if (todayRecommendations.length === 0) {
      // fallback: recommend practicing the weakest topic
      const topWeak = weakAreas[0];
      if (topWeak) {
        todayRecommendations = [
          {
            title: `Practice ${topWeak.subject}: ${topWeak.topic}`,
            minutes: 15,
            questions: 10,
            subject: topWeak.subject,
            topic: topWeak.topic,
            action: { type: "start_quiz", subject: topWeak.subject, topic: topWeak.topic },
          },
        ];
      } else {
        todayRecommendations = [
          {
            title: "Take a quick warm-up quiz",
            minutes: 10,
            questions: 5,
            subject: "Math",
            topic: "General",
            action: { type: "start_quiz", subject: "Math", topic: "General" },
          },
        ];
      }
    }

    const gameLevel = Math.floor((user.points || 0) / 500) + 1;
    const progressToNextLevel = ((user.points || 0) % 500) / 5; // percentage (0-100)

    return res.json({
      needsOnboarding: false,
      user: {
        name: user.name,
        level: user.level, // Class 11/12
        points: user.points || 0,
        streak: user.streak || 0,
        gameLevel,
        progressToNextLevel: Math.round(progressToNextLevel),
      },
      todayRecommendations,
      weakAreas,
    });
  } catch (e) {
    return res.status(500).json({ message: "Server error", error: e.message });
  }
};
