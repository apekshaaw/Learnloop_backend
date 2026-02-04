const express = require("express");
const router = express.Router();

const {
  registerUser,    
  verifySignupOtp,   
  resendSignupOtp,   

  loginUser,
  getMe,
  updateProfile,
  updatePassword,
  deleteMe,
} = require("../controllers/authController");

const { protect } = require("../middleware/authMiddleware");

router.post("/register", registerUser);
router.post("/verify-otp", verifySignupOtp);
router.post("/resend-otp", resendSignupOtp);

router.post("/login", loginUser);

router.get("/me", protect, getMe);
router.put("/profile", protect, updateProfile);
router.put("/change-password", protect, updatePassword);
router.delete("/me", protect, deleteMe);

module.exports = router;
