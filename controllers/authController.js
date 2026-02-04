const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const User = require("../models/User");

const SignupOtp = require("../models/SignupOtp");

const { sendEmail } = require("../utils/sendEmail");

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "30d",
  });
};

const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{6,}$/;

const buildUserResponse = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,

  emailVerified: user.emailVerified,

  level: user.level,

  points: user.points,
  streak: user.streak,
  lastActiveDate: user.lastActiveDate,
  profileImage: user.profileImage,
  gameLevel: user.calculateGameLevel(),

  achievements: user.achievements || [],
  streakSave: user.streakSave || { lastUsedAt: null, totalUsed: 0 },

  // onboarding
  onboardingCompleted: user.onboardingCompleted,
  academicProfile: user.academicProfile,
  learningPreferences: user.learningPreferences,

  // AI fields 
  faculty: user.faculty,
  preferredLearningTime: user.preferredLearningTime,
  learningStyle: user.learningStyle,
});

// helper: generate 6-digit OTP
const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));


const registerUser = async (req, res) => {
  try {
    const { name, email, password, confirmPassword, level } = req.body;

    if (!name || !email || !password || !confirmPassword) {
      return res.status(400).json({ message: "Please fill all required fields" });
    }

    const normalizedEmail = email.toLowerCase().trim();

    if (password !== confirmPassword) {
      return res.status(400).json({ message: "Password and confirm password do not match" });
    }

   
    if (!PASSWORD_REGEX.test(password)) {
      return res.status(400).json({
        message:
          "Password must be 6+ characters and include 1 uppercase letter, 1 number, and 1 special character",
      });
    }

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); 

    await SignupOtp.findOneAndUpdate(
      { email: normalizedEmail },
      {
        email: normalizedEmail,
        otpHash,
        expiresAt,
        attempts: 0,
        lastSentAt: new Date(),
      },
      { upsert: true, new: true }
    );

    await sendEmail({
      to: normalizedEmail,
      subject: "Your LearnLoop verification code",
      text: `Your LearnLoop verification code is: ${otp}\nThis code expires in 10 minutes.`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6;">
          <h2 style="margin:0 0 10px;">Verify your email</h2>
          <p style="margin:0 0 10px;">Your LearnLoop verification code is:</p>
          <div style="font-size:28px;font-weight:800;letter-spacing:4px;margin:12px 0;">${otp}</div>
          <p style="margin:0;">This code expires in <b>10 minutes</b>.</p>
        </div>
      `,
    });

    return res.status(200).json({
      message: "OTP sent to your email",
      email: normalizedEmail,
    });
  } catch (error) {
    console.error("Register(Send OTP) error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};


const verifySignupOtp = async (req, res) => {
  try {
    const { name, email, password, confirmPassword, level, otp } = req.body;

    if (!name || !email || !password || !confirmPassword || !otp) {
      return res.status(400).json({ message: "Please fill all required fields" });
    }

    const normalizedEmail = email.toLowerCase().trim();

    if (password !== confirmPassword) {
      return res.status(400).json({ message: "Password and confirm password do not match" });
    }

    if (!PASSWORD_REGEX.test(password)) {
      return res.status(400).json({
        message:
          "Password must be 6+ characters and include 1 uppercase letter, 1 number, and 1 special character",
      });
    }

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const otpDoc = await SignupOtp.findOne({ email: normalizedEmail });
    if (!otpDoc) {
      return res.status(400).json({ message: "OTP not found. Please request a new code." });
    }

    if (otpDoc.expiresAt < new Date()) {
      return res.status(400).json({ message: "OTP expired. Please request a new code." });
    }

    if (otpDoc.attempts >= 5) {
      return res.status(429).json({ message: "Too many attempts. Please resend OTP." });
    }

    const isOtpValid = await bcrypt.compare(String(otp).trim(), otpDoc.otpHash);
    if (!isOtpValid) {
      otpDoc.attempts += 1;
      await otpDoc.save();
      return res.status(400).json({ message: "Invalid OTP" });
    }

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password,
      level: typeof level === "string" && level.trim() !== "" ? level.trim() : null,
      emailVerified: true,
    });

    await SignupOtp.deleteOne({ email: normalizedEmail });

    return res.status(201).json({
      message: "Email verified. Account created successfully",
      user: buildUserResponse(user),
      token: generateToken(user._id),
    });
  } catch (error) {
    console.error("Verify OTP error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};


const resendSignupOtp = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const normalizedEmail = email.toLowerCase().trim();

    const existing = await SignupOtp.findOne({ email: normalizedEmail });
    if (existing?.lastSentAt) {
      const seconds = (Date.now() - new Date(existing.lastSentAt).getTime()) / 1000;
      if (seconds < 20) {
        return res.status(429).json({ message: "Please wait a moment before resending." });
      }
    }

    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await SignupOtp.findOneAndUpdate(
      { email: normalizedEmail },
      { email: normalizedEmail, otpHash, expiresAt, attempts: 0, lastSentAt: new Date() },
      { upsert: true, new: true }
    );

    await sendEmail({
      to: normalizedEmail,
      subject: "Your LearnLoop verification code (Resent)",
      text: `Your LearnLoop verification code is: ${otp}\nThis code expires in 10 minutes.`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6;">
          <h2 style="margin:0 0 10px;">Your new verification code</h2>
          <div style="font-size:28px;font-weight:800;letter-spacing:4px;margin:12px 0;">${otp}</div>
          <p style="margin:0;">This code expires in <b>10 minutes</b>.</p>
        </div>
      `,
    });

    return res.status(200).json({ message: "OTP resent to your email" });
  } catch (error) {
    console.error("Resend OTP error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};


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

      faculty,
      preferredLearningTime,
      learningStyle,
    } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (typeof name === "string" && name.trim() !== "") user.name = name.trim();

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

    if (profileImage !== undefined) user.profileImage = profileImage;

    if (typeof onboardingCompleted === "boolean") {
      user.onboardingCompleted = onboardingCompleted;
    }

    if (academicProfile && typeof academicProfile === "object") {
      if (academicProfile.grade) user.academicProfile.grade = academicProfile.grade;
      if (academicProfile.faculty) user.academicProfile.faculty = academicProfile.faculty;
      if (academicProfile.board) user.academicProfile.board = academicProfile.board;
      if (typeof academicProfile.schoolName === "string") {
        user.academicProfile.schoolName = academicProfile.schoolName;
      }

      if (academicProfile.grade) user.level = `Class ${academicProfile.grade}`;
      if (academicProfile.faculty) user.faculty = academicProfile.faculty;
    }

    if (learningPreferences && typeof learningPreferences === "object") {
      if (learningPreferences.studyPreference)
        user.learningPreferences.studyPreference = learningPreferences.studyPreference;

      if (learningPreferences.studyTime)
        user.learningPreferences.studyTime = learningPreferences.studyTime;

      if (learningPreferences.challenge)
        user.learningPreferences.challenge = learningPreferences.challenge;

      if (learningPreferences.studyTime) user.preferredLearningTime = learningPreferences.studyTime;

      if (learningPreferences.studyPreference) {
        user.learningStyle =
          learningPreferences.studyPreference === "Practice"
            ? "Kinesthetic"
            : learningPreferences.studyPreference;
      }
    }

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


const updatePassword = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { currentPassword, newPassword, confirmNewPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmNewPassword) {
      return res.status(400).json({ message: "Please fill all password fields" });
    }

    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({
        message: "New password and confirm password do not match",
      });
    }

    if (!PASSWORD_REGEX.test(newPassword)) {
      return res.status(400).json({
        message:
          "New password must be 6+ characters and include 1 uppercase letter, 1 number, and 1 special character",
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


const deleteMe = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ message: "Password is required to delete account" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: "Password is incorrect" });
    }

    await User.deleteOne({ _id: userId });

    return res.json({ message: "Account deleted successfully" });
  } catch (error) {
    console.error("DeleteMe error:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports = {
  registerUser,      
  verifySignupOtp,   
  resendSignupOtp,  
  loginUser,         
  getMe,
  updateProfile,
  updatePassword,
  deleteMe,
};
