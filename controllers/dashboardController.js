const QuizAttempt = require("../models/QuizAttempt");
const User = require("../models/User");
const mlService = require("../services/mlService");


exports.getDashboardSummary = async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.onboardingCompleted) {
      return res.json({
        needsOnboarding: true,
        user: { name: user.name, onboardingCompleted: false },
      });
    }

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

    const recentAttempts = await QuizAttempt.find({ user: userId })
      .sort("-createdAt")
      .limit(10)
      .select("subject topic scorePercentage createdAt");

    let todayRecommendations = [];
    try {
      const aiRec = await mlService.dailyRecommendations({
  student_id: user._id.toString(),
  lastAttempts: recentAttempts.map((a) => ({
    subject: a.subject,
    topic: a.topic,
    scorePercentage: a.scorePercentage,
  })),
  streak: user.streak || 0,
  points: user.points || 0,
});

      if (Array.isArray(aiRec?.today_recommendations)) {
  todayRecommendations = aiRec.today_recommendations.map((r) => ({
    title: r.action,
    minutes: r.priority === "High" ? 25 : r.priority === "Medium" ? 15 : 10,
    questions: r.priority === "High" ? 15 : r.priority === "Medium" ? 10 : 5,
    subject: "General",
    topic: "General",
    note: r.description,
  }));
}

    } catch (_) {}

    if (todayRecommendations.length === 0) {
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

    const gameLevel = user.calculateGameLevel();
    const progressToNextLevel = ((user.points || 0) % 500) / 5; 

    return res.json({
      needsOnboarding: false,
      user: {
        name: user.name,
        level: user.level,
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
