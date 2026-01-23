// controllers/authController.js
const jwt = require("jsonwebtoken");
const User = require("../models/User");

// Generate JWT
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
};

const buildUserResponse = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,

  // content filtering
  level: user.level,

  // gamification
  points: user.points,
  streak: user.streak,
  lastActiveDate: user.lastActiveDate,
  profileImage: user.profileImage,
  gameLevel: Math.floor((user.points || 0) / 500) + 1,

  achievements: user.achievements || [],
  streakSave: user.streakSave || { lastUsedAt: null, totalUsed: 0 },

  // onboarding
  onboardingCompleted: user.onboardingCompleted,
  academicProfile: user.academicProfile,
  learningPreferences: user.learningPreferences,

  // AI fields (optional)
  faculty: user.faculty,
  preferredLearningTime: user.preferredLearningTime,
  learningStyle: user.learningStyle,
});


// -------------------- REGISTER --------------------
// @route   POST /api/auth/register
// @access  Public
const registerUser = async (req, res) => {
  try {
    const { name, email, password, confirmPassword, level } = req.body;

    if (!name || !email || !password || !confirmPassword) {
      return res.status(400).json({ message: "Please fill all required fields" });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters long" });
    }

    if (password !== confirmPassword) {
      return res
        .status(400)
        .json({ message: "Password and confirm password do not match" });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      level: typeof level === "string" && level.trim() !== "" ? level.trim() : null,
    });

    return res.status(201).json({
      message: "User registered successfully",
      user: buildUserResponse(user),
      token: generateToken(user._id),
    });
  } catch (error) {
    console.error("Register error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

// -------------------- LOGIN --------------------
// @route   POST /api/auth/login
// @access  Public
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Please provide email and password" });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const isMatch = await user.matchPassword(password);
    if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

    return res.json({
      message: "Login successful",
      user: buildUserResponse(user),
      token: generateToken(user._id),
    });
  } catch (error) {
    console.error("Login error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

// -------------------- GET ME --------------------
// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const user = await User.findById(userId);

    if (!user) return res.status(404).json({ message: "User not found" });

    return res.json({ user: buildUserResponse(user) });
  } catch (error) {
    console.error("GetMe error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};


const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    const {
      name,
      email,
      level,
      profileImage,

      onboardingCompleted,
      academicProfile,
      learningPreferences,

      // optional AI-alignment fields
      faculty,
      preferredLearningTime,
      learningStyle,
    } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Name
    if (typeof name === "string" && name.trim() !== "") user.name = name.trim();

    // Email uniqueness
    if (typeof email === "string" && email.trim() !== "") {
      const normalizedEmail = email.toLowerCase().trim();
      if (normalizedEmail !== user.email) {
        const emailExists = await User.findOne({ email: normalizedEmail });
        if (emailExists && emailExists._id.toString() !== userId.toString()) {
          return res.status(400).json({ message: "Email already in use" });
        }
        user.email = normalizedEmail;
      }
    }

    // Profile image (allow clear)
    if (profileImage !== undefined) user.profileImage = profileImage;

    // Onboarding completed
    if (typeof onboardingCompleted === "boolean") {
      user.onboardingCompleted = onboardingCompleted;
    }

    // Academic Profile
    if (academicProfile && typeof academicProfile === "object") {
      if (academicProfile.grade) user.academicProfile.grade = academicProfile.grade;
      if (academicProfile.faculty) user.academicProfile.faculty = academicProfile.faculty;
      if (academicProfile.board) user.academicProfile.board = academicProfile.board;
      if (typeof academicProfile.schoolName === "string") {
        user.academicProfile.schoolName = academicProfile.schoolName;
      }

      // Keep top-level fields aligned for quiz filtering + AI dashboard
      if (academicProfile.grade) user.level = `Class ${academicProfile.grade}`;
      if (academicProfile.faculty) user.faculty = academicProfile.faculty;
    }

    // Learning Preferences
    if (learningPreferences && typeof learningPreferences === "object") {
      if (learningPreferences.studyPreference)
        user.learningPreferences.studyPreference = learningPreferences.studyPreference;

      if (learningPreferences.studyTime)
        user.learningPreferences.studyTime = learningPreferences.studyTime;

      if (learningPreferences.challenge)
        user.learningPreferences.challenge = learningPreferences.challenge;

      // Align with AI fields (optional)
      if (learningPreferences.studyTime) user.preferredLearningTime = learningPreferences.studyTime;

      if (learningPreferences.studyPreference) {
        user.learningStyle =
          learningPreferences.studyPreference === "Practice"
            ? "Kinesthetic"
            : learningPreferences.studyPreference; // Visual / Reading/Writing
      }
    }

    // Allow direct overrides too (optional)
    if (typeof level === "string" && level.trim() !== "") user.level = level.trim();
    if (typeof faculty === "string" && faculty.trim() !== "") user.faculty = faculty.trim();
    if (typeof preferredLearningTime === "string" && preferredLearningTime.trim() !== "")
      user.preferredLearningTime = preferredLearningTime.trim();
    if (typeof learningStyle === "string" && learningStyle.trim() !== "")
      user.learningStyle = learningStyle.trim();

    await user.save();

    return res.json({
      message: "Profile updated successfully",
      user: buildUserResponse(user),
    });
  } catch (error) {
    console.error("UpdateProfile error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

// -------------------- CHANGE PASSWORD --------------------
// @route   PUT /api/auth/change-password
// @access  Private
const updatePassword = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { currentPassword, newPassword, confirmNewPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmNewPassword) {
      return res.status(400).json({ message: "Please fill all password fields" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        message: "New password must be at least 6 characters long",
      });
    }

    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({
        message: "New password and confirm password do not match",
      });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    user.password = newPassword;
    await user.save();

    return res.json({ message: "Password updated successfully" });
  } catch (error) {
    console.error("UpdatePassword error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports = {
  registerUser,
  loginUser,
  getMe,
  updateProfile,
  updatePassword,
};
