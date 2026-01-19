const aiService = require('../services/aiService');
const User = require('../models/User');

exports.getStudentDashboard = async (req, res) => {
  try {
    res.json({ 
      success: true, 
      message: 'Dashboard endpoint is working!',
      note: 'Full AI integration will work once you add authentication'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getStudyPlan = async (req, res) => {
  try {
    res.json({ 
      success: true, 
      message: 'Study plan endpoint is working!'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getDailyRecommendations = async (req, res) => {
  try {
    res.json({ 
      success: true, 
      message: 'Recommendations endpoint is working!'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.aiHealthCheck = async (req, res) => {
  try {
    const health = await aiService.healthCheck();
    res.json(health);
  } catch (error) {
    res.status(500).json({ 
      status: 'error', 
      message: 'AI service unavailable',
      error: error.message 
    });
  }
};