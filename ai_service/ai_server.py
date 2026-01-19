from flask import Flask, request, jsonify
from flask_cors import CORS
import pickle
import numpy as np
import pandas as pd
from datetime import datetime

app = Flask(__name__)
CORS(app)  # Allow requests from Node.js backend

# Load all trained models
print("Loading AI models...")
with open('models/performance_predictor.pkl', 'rb') as f:
    performance_model = pickle.load(f)
with open('models/risk_detector.pkl', 'rb') as f:
    risk_model = pickle.load(f)
with open('models/motivation_encoder.pkl', 'rb') as f:
    motivation_encoder = pickle.load(f)
with open('models/anxiety_encoder.pkl', 'rb') as f:
    anxiety_encoder = pickle.load(f)
with open('models/study_time_recommendations.pkl', 'rb') as f:
    study_recommendations = pickle.load(f)
with open('models/student_profiles.pkl', 'rb') as f:
    student_profiles = pickle.load(f)
with open('models/gamification_data.pkl', 'rb') as f:
    gamification_data = pickle.load(f)

print("✓ All models loaded successfully!")

# ============================================
# API ENDPOINTS
# ============================================

@app.route('/health', methods=['GET'])
def health_check():
    """Check if AI service is running"""
    return jsonify({
        'status': 'healthy',
        'message': 'LearnLoop AI Service is running',
        'timestamp': datetime.now().isoformat()
    })

@app.route('/predict-performance', methods=['POST'])
def predict_performance():
    """
    Predict Grade 12 expected score
    Body: {
        "grade_11_percentage": 75,
        "attendance_rate": 85,
        "study_hours_per_day": 4
    }
    """
    try:
        data = request.json
        
        # Extract features
        features = np.array([[
            data['grade_11_percentage'],
            data['attendance_rate'],
            data['study_hours_per_day']
        ]])
        
        # Predict
        prediction = performance_model.predict(features)[0]
        
        # Confidence score (simplified)
        confidence = min(95, max(60, 100 - abs(prediction - data['grade_11_percentage'])))
        
        return jsonify({
            'predicted_grade_12': round(prediction, 1),
            'confidence': round(confidence, 1),
            'improvement_needed': max(0, round(prediction - data['grade_11_percentage'], 1)),
            'message': f"Based on your current performance, you're expected to score {round(prediction, 1)}% in Grade 12"
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/check-risk', methods=['POST'])
def check_risk():
    """
    Check if student is at risk
    Body: {
        "grade_11_percentage": 60,
        "attendance_rate": 75,
        "study_hours_per_day": 2,
        "motivation_level": "Low",
        "exam_anxiety_level": "High"
    }
    """
    try:
        data = request.json
        
        # Encode categorical variables
        motivation_encoded = motivation_encoder.transform([data['motivation_level']])[0]
        anxiety_encoded = anxiety_encoder.transform([data['exam_anxiety_level']])[0]
        
        # Prepare features
        features = np.array([[
            data['grade_11_percentage'],
            data['attendance_rate'],
            data['study_hours_per_day'],
            motivation_encoded,
            anxiety_encoded
        ]])
        
        # Predict
        is_at_risk = risk_model.predict(features)[0]
        risk_probability = risk_model.predict_proba(features)[0][1] * 100
        
        # Generate recommendations
        recommendations = []
        if data['attendance_rate'] < 80:
            recommendations.append("Improve attendance - aim for 85%+")
        if data['study_hours_per_day'] < 3:
            recommendations.append("Increase study hours to at least 3-4 hours daily")
        if data['motivation_level'] == 'Low':
            recommendations.append("Set small daily goals to build momentum")
        if data['exam_anxiety_level'] == 'High':
            recommendations.append("Practice relaxation techniques before exams")
        
        return jsonify({
            'at_risk': bool(is_at_risk),
            'risk_percentage': round(risk_probability, 1),
            'risk_level': 'High' if risk_probability > 60 else 'Medium' if risk_probability > 30 else 'Low',
            'recommendations': recommendations,
            'message': 'Immediate action needed' if is_at_risk else 'Keep up the good work!'
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/personalized-plan', methods=['POST'])
def personalized_plan():
    """
    Generate personalized study plan
    Body: {
        "student_id": "S001",
        "grade_11_percentage": 78,
        "weak_subjects": ["Chemistry", "Biology"],
        "study_hours_per_day": 4,
        "exam_anxiety_level": "Medium"
    }
    """
    try:
        data = request.json
        student_id = data.get('student_id', 'UNKNOWN')
        
        # Get study time recommendation
        best_study_time = study_recommendations.get(student_id, {}).get(
            'best_time', 'Morning (6-11 AM)'
        )
        
        # Calculate daily breakdown
        total_hours = data.get('study_hours_per_day', 4)
        weak_subjects = data.get('weak_subjects', [])
        
        # Allocate more time to weak subjects
        if weak_subjects:
            weak_subject_time = round((total_hours * 0.6) / len(weak_subjects), 1)
            strong_subject_time = round((total_hours * 0.4) / 2, 1)  # Split remaining
        else:
            weak_subject_time = 0
            strong_subject_time = round(total_hours / 3, 1)
        
        # Generate weekly goals
        performance = data.get('grade_11_percentage', 70)
        if performance < 65:
            weekly_target = "Complete 50 practice questions"
            focus = "Building fundamentals"
        elif performance < 80:
            weekly_target = "Complete 75 practice questions + 2 mock tests"
            focus = "Strengthening concepts"
        else:
            weekly_target = "Complete 100 advanced questions + 3 mock tests"
            focus = "Achieving excellence"
        
        # Anxiety management
        anxiety_tips = []
        if data.get('exam_anxiety_level') in ['High', 'Medium']:
            anxiety_tips = [
                "Take 5-minute breaks every 45 minutes",
                "Practice deep breathing before study sessions",
                "Reward yourself after completing daily goals"
            ]
        
        plan = {
            'best_study_time': best_study_time,
            'daily_schedule': {
                'weak_subjects': {
                    'subjects': weak_subjects,
                    'time_per_subject': f"{weak_subject_time} hours"
                },
                'strong_subjects': {
                    'time': f"{strong_subject_time} hours"
                },
                'revision': f"{round(total_hours * 0.2, 1)} hours",
                'breaks': "10 min every hour"
            },
            'weekly_target': weekly_target,
            'focus_area': focus,
            'anxiety_management': anxiety_tips,
            'motivational_message': f"You've got this! Focus on {focus.lower()} this week."
        }
        
        return jsonify(plan)
    
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/gamification-status', methods=['GET'])
def gamification_status():
    """
    Get gamification metrics for a student
    Query: ?student_id=S001
    """
    try:
        student_id = request.args.get('student_id')
        
        if student_id not in gamification_data:
            return jsonify({'error': 'Student not found'}), 404
        
        data = gamification_data[student_id]
        
        # Calculate next level progress
        current_level = data['level']
        current_points = data['total_points']
        next_level_points = (current_level + 1) * 500
        progress_to_next = round((current_points % 500) / 500 * 100, 1)
        
        return jsonify({
            'student_id': student_id,
            'level': current_level,
            'total_points': current_points,
            'badges_earned': data['badges_earned'],
            'streak_days': data['streak_days'],
            'leaderboard_rank': data['leaderboard_rank'],
            'next_level_in': next_level_points - current_points,
            'progress_to_next_level': progress_to_next,
            'achievements': [
                f"🏆 Level {current_level} Champion",
                f"🔥 {data['streak_days']}-Day Streak",
                f"⭐ {data['badges_earned']} Badges Collected"
            ]
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/daily-recommendations', methods=['POST'])
def daily_recommendations():
    """
    Get daily study recommendations
    Body: {
        "student_id": "S001",
        "recent_quiz_scores": [75, 80, 72],
        "topics_covered_this_week": ["Algebra", "Geometry"]
    }
    """
    try:
        data = request.json
        recent_scores = data.get('recent_quiz_scores', [])
        
        # Analyze performance trend
        if recent_scores:
            avg_score = sum(recent_scores) / len(recent_scores)
            trend = "improving" if len(recent_scores) > 1 and recent_scores[-1] > recent_scores[0] else "stable"
        else:
            avg_score = 0
            trend = "unknown"
        
        # Generate recommendations
        recommendations = []
        
        if avg_score < 70:
            recommendations.append({
                'priority': 'High',
                'action': 'Review fundamentals',
                'description': 'Spend extra time on basics before moving forward'
            })
        
        if trend == "improving":
            recommendations.append({
                'priority': 'Medium',
                'action': 'Maintain momentum',
                'description': 'Keep up the great work! Try slightly harder questions'
            })
        
        recommendations.append({
            'priority': 'Medium',
            'action': 'Practice new topic',
            'description': 'Try Trigonometry - it builds on what you learned'
        })
        
        recommendations.append({
            'priority': 'Low',
            'action': 'Weekly mock test',
            'description': 'Test yourself on all topics covered this week'
        })
        
        return jsonify({
            'date': datetime.now().strftime('%Y-%m-%d'),
            'performance_summary': {
                'average_score': round(avg_score, 1),
                'trend': trend,
                'topics_mastered': len(data.get('topics_covered_this_week', []))
            },
            'today_recommendations': recommendations,
            'motivational_quote': "Success is the sum of small efforts repeated day in and day out."
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 400

# ============================================
# RUN SERVER
# ============================================

if __name__ == '__main__':
    print("\n" + "=" * 60)
    print("🚀 LEARNLOOP AI SERVICE STARTING...")
    print("=" * 60)
    print("\nEndpoints available:")
    print("  GET  /health - Health check")
    print("  POST /predict-performance - Predict Grade 12 score")
    print("  POST /check-risk - Check if student at risk")
    print("  POST /personalized-plan - Get personalized study plan")
    print("  GET  /gamification-status - Get points, badges, level")
    print("  POST /daily-recommendations - Get daily suggestions")
    print("\nRunning on: http://localhost:5000")
    print("=" * 60 + "\n")
    
    app.run(host='0.0.0.0', port=5001, debug=True)