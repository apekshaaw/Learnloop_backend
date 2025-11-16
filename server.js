// server.js
const express = require("express");
const dotenv = require("dotenv");
const morgan = require("morgan");
const cors = require("cors");
const connectDB = require("./config/db");

dotenv.config();

const app = express();

// connect to Mongo
connectDB();

// middlewares
app.use(cors());
app.use(express.json()); // parse JSON body
app.use(morgan("dev"));

// test route
app.get("/", (req, res) => {
  res.send("LearnLoop API is running...");
});

// routes (we'll fill these files next)
const authRoutes = require("./routes/authRoutes");
const quizRoutes = require("./routes/quizRoutes");

app.use("/api/auth", authRoutes);
app.use("/api/quiz", quizRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
