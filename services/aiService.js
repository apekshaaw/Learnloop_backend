const axios = require('axios');

const AI_SERVER_URL = 'http://localhost:5001';

class AIService {
  
  async healthCheck() {
    try {
      const response = await axios.get(`${AI_SERVER_URL}/health`, {
        timeout: 5000
      });
      return response.data;
    } catch (error) {
      console.error('AI Service Health Check Failed:', error.message);
      return { 
        status: 'unhealthy', 
        error: error.message,
        message: 'AI service is not responding.'
      };
    }
  }

  async predictPerformance(studentData) {
    try {
      const response = await axios.post(
        `${AI_SERVER_URL}/predict-performance`, 
        studentData,
        { timeout: 10000 }
      );
      return response.data;
    } catch (error) {
      console.error('AI Prediction Error:', error.message);
      throw new Error('Failed to predict performance.');
    }
  }

  async checkRisk(studentData) {
    try {
      const response = await axios.post(
        `${AI_SERVER_URL}/check-risk`, 
        studentData,
        { timeout: 10000 }
      );
      return response.data;
    } catch (error) {
      console.error('AI Risk Check Error:', error.message);
      throw new Error('Failed to check student risk.');
    }
  }

  async getPersonalizedPlan(planData) {
    try {
      const response = await axios.post(
        `${AI_SERVER_URL}/personalized-plan`, 
        planData,
        { timeout: 10000 }
      );
      return response.data;
    } catch (error) {
      console.error('AI Study Plan Error:', error.message);
      throw new Error('Failed to generate study plan.');
    }
  }

  async getGamificationStatus(studentId) {
    try {
      const response = await axios.get(`${AI_SERVER_URL}/gamification-status`, {
        params: { student_id: studentId },
        timeout: 10000
      });
      return response.data;
    } catch (error) {
      console.error('AI Gamification Error:', error.message);
      return {
        student_id: studentId,
        level: 1,
        total_points: 0,
        badges_earned: 0,
        streak_days: 0,
        leaderboard_rank: 0,
        next_level_in: 500,
        progress_to_next_level: 0,
        achievements: ['🎯 Getting Started']
      };
    }
  }

  async getDailyRecommendations(data) {
    try {
      const response = await axios.post(
        `${AI_SERVER_URL}/daily-recommendations`, 
        data,
        { timeout: 10000 }
      );
      return response.data;
    } catch (error) {
      console.error('AI Recommendations Error:', error.message);
      throw new Error('Failed to get daily recommendations.');
    }
  }
}

module.exports = new AIService();