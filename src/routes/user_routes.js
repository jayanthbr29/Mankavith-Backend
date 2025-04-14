const express = require("express");
const router = express.Router();
const authenticateJWT = require("../middleware/authenticator");
const userController = require("../controller/user_controller");

router.post("/register", userController.register);
router.post("/login", userController.login);
router.post("/verify-otp", userController.verifyOTP);
router.post("/resend-otp", userController.resendOTP);
router.post("/refreshToken", userController.refreshToken);
router.post("/loginSendOtp", userController.loginSendOtp);
router.post("/verifyLoginOtp", userController.verifyLoginOtp);
router.post("/resendLoginOtp", userController.resendLoginOtp);
router.post("/logout", authenticateJWT, userController.logout);
router.post("/createAdmin", userController.createAdmin);
router.get("/get/userById/:id", authenticateJWT, userController.getUserById);
router.get("/get/users", authenticateJWT, userController.getAllUsers);

module.exports = router;