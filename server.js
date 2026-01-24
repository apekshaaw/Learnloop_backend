// server.js
console.log("🔥 SERVER FILE EXECUTING");

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const authRoutes = require("./routes/authRoutes");
const quizRoutes = require("./routes/quizRoutes");
const aiRoutes = require("./routes/aiRoutes");
const onboardingRoutes = require("./routes/onboardingRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const mlRoutes = require("./routes/mlRoutes"); 

const app = express();

// ✅ Debug env check (temporary)
console.log("GEMINI_API_KEY present?", Boolean(process.env.GEMINI_API_KEY));
console.log("GEMINI_MODEL =", process.env.GEMINI_MODEL);
console.log("AI_SERVICE_URL =", process.env.AI_SERVICE_URL); 

// CORS Configuration - Allow frontend to connect
app.use(
  cors({
    origin: "http://localhost:5173", // Vite frontend URL
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Routes (IMPORTANT: mount ALL routes BEFORE error + 404)
app.use("/api/debug", require("./routes/debugRoutes"));

app.use("/api/auth", authRoutes);
app.use("/api/quiz", quizRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/onboarding", onboardingRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/ml", mlRoutes); 

// Root route
app.get("/", (req, res) => {
  res.json({
    message: "LearnLoop API is running",
    endpoints: {
      auth: "/api/auth",
      quiz: "/api/quiz",
      ai: "/api/ai",
      onboarding: "/api/onboarding",
      dashboard: "/api/dashboard",
      ml: "/api/ml", // ✅ NEW
      debug: "/api/debug",
    },
  });
});

// MongoDB connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✓ MongoDB Connected"))
  .catch((err) => console.error("MongoDB error:", err));

// ✅ 404 handler (must come AFTER routes)
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// ✅ Error handling middleware (must be LAST)
app.use((err, req, res, next) => {
  console.error(err.stack || err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Something went wrong!",
    details: err.data || null, // ✅ helpful when Python returns error JSON
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Backend URL: http://localhost:${PORT}`);
  console.log(`🔗 Frontend should connect to: http://localhost:${PORT}/api`);
});
