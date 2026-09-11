const express = require("express");
const {
  login,
  refreshToken,
  loginGoogle,
  loginEmployee,
  deactivateAccount,
  loginApple,
  check_email,
  confirmLogin,
} = require("../controller/auth.js");
const { authUser, identifyUser } = require("../middleware/auth.js");

const router = express.Router();

router.post("/login", login);
router.post("/loginEmployee", loginEmployee);
router.post("/login_google", loginGoogle);
router.post("/login_apple", loginApple);
router.post("/refreshToken", refreshToken);
router.post("/deactivate_account", authUser, deactivateAccount);
router.post("/check_email", check_email);
router.post("/confirmLogin", confirmLogin);

module.exports = router;
