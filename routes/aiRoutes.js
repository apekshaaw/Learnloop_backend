const express = require('express');
const router = express.Router();
const aiController = require('../controllers/aiController');

// Public routes (no authentication required for testing)
router.get('/health', aiController.aiHealthCheck);
router.get('/dashboard', aiController.getStudentDashboard);
router.post('/study-plan', aiController.getStudyPlan);
router.post('/recommendations', aiController.getDailyRecommendations);

module.exports = router;