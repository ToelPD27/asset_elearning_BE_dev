const express = require("express");
const {
  login,
  refreshToken,
  loginGoogle,
  loginEmployee,
} = require("../controller/auth.js");

const router = express.Router();

router.post("/login", login);
router.post("/loginEmployee", loginEmployee);
router.post("/login_google", loginGoogle);
router.post("/refreshToken", refreshToken);

module.exports = router;
