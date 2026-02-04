const User = require("../models/User");
const aiService = require("../services/aiService");

exports.updateAcademicProfile = async (req, res) => {
  try {
    const userId = req.user._id;

    const { grade, faculty, board, schoolName, scienceStream } = req.body; 

    if (!grade || !faculty || !board) {
      return res.status(400).json({ message: "grade, faculty, and board are required" });
    }

    if (faculty === "Science") {
      if (!scienceStream || !["Biology", "Computer Science"].includes(scienceStream)) {
        return res.status(400).json({
          message: "For Science faculty, scienceStream must be Biology or Computer Science",
        });
      }
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.academicProfile = {
      grade,
      faculty,
      board,
      schoolName: schoolName || "",
      scienceStream: faculty === "Science" ? scienceStream : null,
    };

    user.faculty = faculty;

    user.level = grade === "11" ? "Class 11" : "Class 12";

    await user.save();

    res.json({
      message: "Academic profile updated",
      academicProfile: user.academicProfile,
      level: user.level,
    });
  } catch (e) {
    res.status(500).json({ message: "Server error", error: e.message });
  }
};

exports.updateLearningPreferences = async (req, res) => {
  try {
    const userId = req.user._id;
    const { studyPreference, studyTime, challenge } = req.body;

    if (!studyPreference || !studyTime || !challenge) {
      return res.status(400).json({ message: "studyPreference, studyTime, challenge are required" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.learningPreferences = { studyPreference, studyTime, challenge };

    user.preferredLearningTime = studyTime;

    if (studyPreference === "Practice") user.learningStyle = "Kinesthetic";
    else user.learningStyle = studyPreference;

    if (challenge === "Exam anxiety") user.examAnxietyLevel = "High";

    await user.save();

    res.json({
      message: "Learning preferences updated",
      learningPreferences: user.learningPreferences,
    });
  } catch (e) {
    res.status(500).json({ message: "Server error", error: e.message });
  }
};

exports.completeOnboarding = async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.academicProfile?.grade || !user.learningPreferences?.studyPreference) {
      return res.status(400).json({
        message: "Complete academic profile and learning preferences before finishing onboarding",
      });
    }

    if (user.academicProfile?.faculty === "Science" && !user.academicProfile?.scienceStream) {
      return res.status(400).json({
        message: "Please choose Biology or Computer Science before finishing onboarding",
      });
    }

    user.onboardingCompleted = true;

    try {
      const aiResult = await aiService.predictPerformance({
        student_id: user.studentId,
        grade11Percentage: user.grade11Percentage,
        attendanceRate: user.attendanceRate,
        studyHoursPerDay: user.studyHoursPerDay,
        preferredLearningTime: user.preferredLearningTime,
        learningStyle: user.learningStyle,
        motivationLevel: user.motivationLevel,
        examAnxietyLevel: user.examAnxietyLevel,
        faculty: user.faculty,
      });

      user.aiPredictions = {
        predictedGrade12: aiResult?.predicted_grade12 ?? aiResult?.predictedGrade12 ?? null,
        riskLevel: aiResult?.risk_level ?? aiResult?.riskLevel ?? "Medium",
        lastUpdated: new Date(),
      };
    } catch (_) {
    }

    await user.save();

    res.json({
      message: "Onboarding completed",
      onboardingCompleted: true,
    });
  } catch (e) {
    res.status(500).json({ message: "Server error", error: e.message });
  }
};
