const express = require("express");
const router = express.Router();

const aiController = require("../controllers/aiController");
const { protect } = require("../middleware/authMiddleware");

router.get("/health", aiController.aiHealthCheck);

router.post("/coach", protect, aiController.aiCoach);

module.exports = router;
