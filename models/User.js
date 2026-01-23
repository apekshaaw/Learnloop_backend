// models/User.js
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    // =========================
    // Core Auth Fields
    // =========================
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 6,
    },

    // =========================
    // LearnLoop Gamification (basic)
    // NOTE: `level` here is Class Level ("Class 11"/"Class 12") used for content filtering.
    // =========================
    level: {
      type: String, // e.g. "Class 11", "Class 12"
      default: null,
    },
    points: {
      type: Number,
      default: 0,
    },
    streak: {
      type: Number,
      default: 0,
    },
    lastActiveDate: {
      type: Date,
      default: null,
    },
    profileImage: {
      type: String,
      default: null,
    },

    // ============================================
    // ONBOARDING FIELDS (Claude/Thesis Flow)
    // ============================================
    onboardingCompleted: {
      type: Boolean,
      default: false,
    },

    academicProfile: {
  grade: { type: String, enum: ["11", "12"], default: null },
  faculty: {
    type: String,
    enum: ["Science", "Management", "Humanities"],
    default: null,
  },
  scienceStream: {
    type: String,
    enum: ["Biology", "Computer Science"],
    default: null,
  },
  board: { type: String, enum: ["NEB", "Other"], default: "NEB" },
  schoolName: { type: String, trim: true, default: "" },
},


    learningPreferences: {
      studyPreference: {
        type: String,
        enum: ["Visual", "Reading/Writing", "Practice"],
        default: null,
      },
      studyTime: {
        type: String,
        enum: ["Morning", "Afternoon", "Evening", "Night"],
        default: null,
      },
      challenge: {
        type: String,
        enum: [
          "Staying motivated",
          "Managing time",
          "Understanding difficult topics",
          "Exam anxiety",
        ],
        default: null,
      },
    },

    // ============================================
    // AI-RELATED FIELDS (kept as-is)
    // ============================================
    studentId: {
      type: String,
      unique: true,
      default: function () {
        // Generates IDs like S001, S002, S003...
        return (
          "S" + String(Math.floor(Math.random() * 10000)).padStart(4, "0")
        );
      },
    },

        // =========================
    // Gamification (Phase 1 polish)
    // =========================
    achievements: [
      {
        key: { type: String, required: true }, // e.g. "FIRST_QUIZ"
        unlockedAt: { type: Date, default: Date.now },
      },
    ],

    streakSave: {
      lastUsedAt: { type: Date, default: null },
      totalUsed: { type: Number, default: 0 },
    },


    // Academic Performance
    grade11Percentage: {
      type: Number,
      min: 0,
      max: 100,
      default: 70,
    },
    grade12Expected: {
      type: Number,
      min: 0,
      max: 100,
      default: null,
    },
    attendanceRate: {
      type: Number,
      min: 0,
      max: 100,
      default: 80,
    },

    // Study Behavior
    studyHoursPerDay: {
      type: Number,
      min: 0,
      max: 24,
      default: 4,
    },
    preferredLearningTime: {
      type: String,
      enum: ["Morning", "Afternoon", "Evening", "Night"],
      default: "Morning",
    },
    learningStyle: {
      type: String,
      enum: ["Visual", "Auditory", "Kinesthetic", "Reading/Writing"],
      default: "Visual",
    },

    // Psychological Factors
    motivationLevel: {
      type: String,
      enum: ["Low", "Medium", "High"],
      default: "Medium",
    },
    examAnxietyLevel: {
      type: String,
      enum: ["Low", "Medium", "High"],
      default: "Medium",
    },

    // Subjects & Proficiency
    // NOTE: Removed duplicate faculty field - it now lives in academicProfile.faculty
    weakSubjects: [
      {
        type: String,
        trim: true,
      },
    ],
    strongSubjects: [
      {
        type: String,
        trim: true,
      },
    ],

    // Subject Proficiency Levels
    englishProficiency: {
      type: String,
      enum: ["Low", "Medium", "High"],
      default: "Medium",
    },
    mathProficiency: {
      type: String,
      enum: ["Low", "Medium", "High"],
      default: "Medium",
    },
    scienceProficiency: {
      type: String,
      enum: ["Low", "Medium", "High"],
      default: "Medium",
    },

    // Support Systems
    peerStudyGroup: {
      type: Boolean,
      default: false,
    },
    tuitionClasses: {
      type: Boolean,
      default: false,
    },

    // Technology Access
    deviceAccess: {
      type: String,
      enum: [
        "Smartphone",
        "Laptop",
        "Tablet",
        "Smartphone & Laptop",
        "Laptop & Tablet",
      ],
      default: "Smartphone",
    },
    internetQuality: {
      type: String,
      enum: ["Poor", "Average", "Good", "Excellent"],
      default: "Average",
    },

    // Career & Goals
    careerAspiration: {
      type: String,
      trim: true,
      default: "",
    },

    // AI-Generated Predictions
    aiPredictions: {
      predictedGrade12: { type: Number, default: null },
      riskLevel: {
        type: String,
        enum: ["Low", "Medium", "High"],
        default: null,
      },
      lastUpdated: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

// Hash password before save
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare passwords
userSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

// Update AI predictions
userSchema.methods.updateAIPredictions = function (predictions) {
  this.aiPredictions = {
    ...predictions,
    lastUpdated: new Date(),
  };
  return this.save();
};

// Gamification level computed from points (do NOT store in `level`)
userSchema.methods.calculateGameLevel = function () {
  return Math.floor((this.points || 0) / 500) + 1;
};

userSchema.methods.addPoints = function (pointsToAdd) {
  this.points = (this.points || 0) + pointsToAdd;
  return this.save();
};

const User = mongoose.model("User", userSchema);
module.exports = User;