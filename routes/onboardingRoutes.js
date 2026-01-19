const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/authMiddleware");
const onboardingController = require("../controllers/onboardingController");

router.put("/academic", protect, onboardingController.updateAcademicProfile);
router.put("/preferences", protect, onboardingController.updateLearningPreferences);
router.post("/complete", protect, onboardingController.completeOnboarding);

module.exports = router;
