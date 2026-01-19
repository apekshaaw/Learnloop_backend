const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/authMiddleware");
const dashboardController = require("../controllers/dashboardController");

router.get("/summary", protect, dashboardController.getDashboardSummary);

module.exports = router;
