// seed/seedQuestions.js
require("dotenv").config();
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const Question = require("../models/Question");

/**
 * Run:
 *   node seed/seedQuestions.js
 *   node seed/seedQuestions.js --clear
 */

function subjectFromFileName(file) {
  // physics.json -> Physics
  // computer_science.json -> Computer Science
  // business_studies.json -> Business Studies
  return file
    .replace(".json", "")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function levelFromFolder(folder) {
  // class11 -> Class 11
  // class12 -> Class 12
  if (folder === "class11") return "Class 11";
  if (folder === "class12") return "Class 12";
  return folder;
}

function validateAndNormalize(q, level, subject, srcLabel) {
  if (!q || typeof q !== "object") {
    throw new Error(`Invalid question object in ${srcLabel}`);
  }

  const questionText = String(q.questionText || "").trim();
  const options = Array.isArray(q.options) ? q.options.map((o) => String(o).trim()) : [];
  const correctOptionIndex = q.correctOptionIndex;

  if (!questionText) {
    throw new Error(`Missing questionText in ${srcLabel}`);
  }
  if (!options.length || options.length < 2) {
    throw new Error(`Options must be an array of at least 2 in ${srcLabel} for: "${questionText}"`);
  }
  if (typeof correctOptionIndex !== "number" || correctOptionIndex < 0 || correctOptionIndex >= options.length) {
    throw new Error(`Invalid correctOptionIndex in ${srcLabel} for: "${questionText}"`);
  }

  const difficulty = (q.difficulty || "medium").toLowerCase();
  const allowed = new Set(["easy", "medium", "hard"]);
  const finalDifficulty = allowed.has(difficulty) ? difficulty : "medium";

  return {
    level,
    subject,
    topic: q.topic ? String(q.topic).trim() : "",
    questionText,
    options,
    correctOptionIndex,
    difficulty: finalDifficulty,
  };
}

function loadAllQuestions() {
  const bankRoot = path.join(__dirname, "bank");
  const classFolders = ["class11", "class12"];
  const all = [];

  for (const classFolder of classFolders) {
    const folderPath = path.join(bankRoot, classFolder);

    if (!fs.existsSync(folderPath)) {
      throw new Error(`Missing folder: ${folderPath}`);
    }

    const files = fs.readdirSync(folderPath).filter((f) => f.endsWith(".json"));
    if (!files.length) {
      console.warn(`⚠️ No JSON files found in: ${folderPath}`);
      continue;
    }

    const level = levelFromFolder(classFolder);

    for (const file of files) {
      const subject = subjectFromFileName(file);
      const fullPath = path.join(folderPath, file);
      const raw = fs.readFileSync(fullPath, "utf8");

      let arr;
      try {
        arr = JSON.parse(raw);
      } catch (e) {
        throw new Error(`JSON parse failed in ${fullPath}: ${e.message}`);
      }

      if (!Array.isArray(arr)) {
        throw new Error(`Top-level JSON must be an array in ${fullPath}`);
      }

      arr.forEach((q, idx) => {
        const label = `${classFolder}/${file} (index ${idx})`;
        all.push(validateAndNormalize(q, level, subject, label));
      });
    }
  }

  return all;
}

async function run() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error("❌ MONGO_URI not found in .env");
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  console.log("✓ MongoDB Connected");

  const shouldClear = process.argv.includes("--clear");
  if (shouldClear) {
    const del = await Question.deleteMany({});
    console.log(`🧹 Cleared questions: ${del.deletedCount}`);
  }

  const QUESTIONS = loadAllQuestions();
  console.log(`📦 Loaded from JSON: ${QUESTIONS.length}`);

  // Avoid duplicates by level + subject + questionText
  const existing = await Question.find({}, { questionText: 1, level: 1, subject: 1 }).lean();
  const existingKey = new Set(
    existing.map((q) => `${q.level}__${q.subject}__${q.questionText}`.toLowerCase())
  );

  const toInsert = QUESTIONS.filter((q) => {
    const k = `${q.level}__${q.subject}__${q.questionText}`.toLowerCase();
    return !existingKey.has(k);
  });

  if (!toInsert.length) {
    console.log("✅ No new questions to insert (all already exist).");
    process.exit(0);
  }

  await Question.insertMany(toInsert);
  console.log(`✅ Inserted questions: ${toInsert.length}`);

  const stats = await Question.aggregate([
    { $group: { _id: { level: "$level", subject: "$subject" }, count: { $sum: 1 } } },
    { $sort: { "_id.level": 1, "_id.subject": 1 } },
  ]);

  console.log("📊 Bank summary:");
  stats.forEach((s) => console.log(`- ${s._id.level} | ${s._id.subject}: ${s.count}`));

  process.exit(0);
}

run().catch((e) => {
  console.error("❌ Seed failed:", e.message);
  process.exit(1);
});
