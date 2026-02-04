const router = require("express").Router();
const ctrl = require("../controllers/mlController");

const auth = require("../middleware/authMiddleware");


const protect = typeof auth === "function" ? auth : auth.protect;

if (!protect) {
  throw new Error(
    "authMiddleware export not found. Export either `module.exports = protect` OR `{ protect }`."
  );
}

router.use(protect);

router.get("/health", ctrl.aiHealth);
router.post("/predict-performance", ctrl.predictPerformance);
router.post("/check-risk", ctrl.checkRisk);
router.post("/personalized-plan", ctrl.personalizedPlan);
router.get("/gamification-status", ctrl.gamificationStatus);
router.post("/daily-recommendations", ctrl.dailyRecommendations);

module.exports = router;
