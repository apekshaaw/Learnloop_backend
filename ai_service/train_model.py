import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
import pickle
import os

print("=" * 60)
print("LEARNLOOP AI MODEL TRAINING")
print("=" * 60)

# Load datasets
print("\n📁 Loading datasets...")
students = pd.read_csv('../data/raw/students.csv')
progress = pd.read_csv('../data/raw/progress.csv')
sessions = pd.read_csv('../data/raw/sessions.csv')
gamification = pd.read_csv('../data/raw/gamification.csv')

print(f"✓ Loaded {len(students)} student profiles")
print(f"✓ Loaded {len(progress)} progress records")
print(f"✓ Loaded {len(sessions)} learning sessions")
print(f"✓ Loaded {len(gamification)} gamification profiles")

# ============================================
# MODEL 1: Performance Prediction
# ============================================
print("\n🎯 Training Model 1: Performance Prediction...")

# Prepare features
X_perf = students[[
    'grade_11_percentage', 
    'attendance_rate', 
    'study_hours_per_day'
]]
y_perf = students['grade_12_expected']

# Train-test split
X_train, X_test, y_train, y_test = train_test_split(
    X_perf, y_perf, test_size=0.2, random_state=42
)

# Train model
performance_model = RandomForestRegressor(n_estimators=100, random_state=42)
performance_model.fit(X_train, y_train)

# Evaluate
score = performance_model.score(X_test, y_test)
print(f"✓ Model Accuracy: {score * 100:.2f}%")

# Save model
os.makedirs('models', exist_ok=True)
with open('models/performance_predictor.pkl', 'wb') as f:
    pickle.dump(performance_model, f)
print("✓ Saved: performance_predictor.pkl")

# ============================================
# MODEL 2: Risk Detection (At-Risk Students)
# ============================================
print("\n⚠️  Training Model 2: At-Risk Student Detection...")

# Create risk labels (1 = at risk, 0 = safe)
students['at_risk'] = (
    (students['grade_11_percentage'] < 65) & 
    (students['attendance_rate'] < 80)
).astype(int)

# Encode categorical variables
le_motivation = LabelEncoder()
le_anxiety = LabelEncoder()

students['motivation_encoded'] = le_motivation.fit_transform(students['motivation_level'])
students['anxiety_encoded'] = le_anxiety.fit_transform(students['exam_anxiety_level'])

X_risk = students[[
    'grade_11_percentage',
    'attendance_rate',
    'study_hours_per_day',
    'motivation_encoded',
    'anxiety_encoded'
]]
y_risk = students['at_risk']

# Train model
risk_model = RandomForestClassifier(n_estimators=100, random_state=42)
risk_model.fit(X_risk, y_risk)

risk_score = risk_model.score(X_risk, y_risk)
print(f"✓ Model Accuracy: {risk_score * 100:.2f}%")

# Save model and encoders
with open('models/risk_detector.pkl', 'wb') as f:
    pickle.dump(risk_model, f)
with open('models/motivation_encoder.pkl', 'wb') as f:
    pickle.dump(le_motivation, f)
with open('models/anxiety_encoder.pkl', 'wb') as f:
    pickle.dump(le_anxiety, f)
print("✓ Saved: risk_detector.pkl")

# ============================================
# MODEL 3: Study Time Recommender
# ============================================
print("\n⏰ Creating Model 3: Study Time Recommendations...")

# Calculate best study time for each student
study_recommendations = {}

for student_id in sessions['student_id'].unique():
    student_sessions = sessions[sessions['student_id'] == student_id]
    
    # Group by time of day
    student_sessions['hour'] = pd.to_datetime(
        student_sessions['session_time'], 
        format='%H:%M'
    ).dt.hour
    
    # Calculate average scores by time period
    morning = student_sessions[student_sessions['hour'].between(6, 11)]['quiz_score'].mean()
    afternoon = student_sessions[student_sessions['hour'].between(12, 17)]['quiz_score'].mean()
    evening = student_sessions[student_sessions['hour'].between(18, 21)]['quiz_score'].mean()
    night = student_sessions[student_sessions['hour'] >= 22]['quiz_score'].mean()
    
    times = {
        'Morning (6-11 AM)': morning,
        'Afternoon (12-5 PM)': afternoon,
        'Evening (6-9 PM)': evening,
        'Night (10+ PM)': night
    }
    
    # Get best time (ignore NaN)
    times = {k: v for k, v in times.items() if not pd.isna(v)}
    if times:
        best_time = max(times, key=times.get)
        best_score = times[best_time]
        study_recommendations[student_id] = {
            'best_time': best_time,
            'average_score': round(best_score, 1)
        }

# Save recommendations
with open('models/study_time_recommendations.pkl', 'wb') as f:
    pickle.dump(study_recommendations, f)
print(f"✓ Saved study recommendations for {len(study_recommendations)} students")

# ============================================
# CREATE LOOKUP DATA FOR QUICK ACCESS
# ============================================
print("\n📊 Creating lookup tables...")

# Student profiles lookup
student_lookup = students.to_dict('records')
with open('models/student_profiles.pkl', 'wb') as f:
    pickle.dump(student_lookup, f)

# Gamification lookup
gamification_lookup = gamification.set_index('student_id').to_dict('index')
with open('models/gamification_data.pkl', 'wb') as f:
    pickle.dump(gamification_lookup, f)

print("✓ Saved lookup tables")

# ============================================
# SUMMARY
# ============================================
print("\n" + "=" * 60)
print("✅ AI TRAINING COMPLETE!")
print("=" * 60)
print("\nModels created:")
print("  1. performance_predictor.pkl - Predicts Grade 12 scores")
print("  2. risk_detector.pkl - Identifies struggling students")
print("  3. study_time_recommendations.pkl - Best study times")
print("  4. student_profiles.pkl - Student data lookup")
print("  5. gamification_data.pkl - Points, badges, levels")
print("\nAll models saved in: ai_service/models/")
print("=" * 60)