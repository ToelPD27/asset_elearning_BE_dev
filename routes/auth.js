const express = require("express");
const {
  login,
  refreshToken,
  loginGoogle,
  loginEmployee,
  deactivateAccount,
} = require("../controller/auth.js");
const { authUser, identifyUser } = require("../middleware/auth.js");

const router = express.Router();

router.post("/login", login);
router.post("/loginEmployee", loginEmployee);
router.post("/login_google", loginGoogle);
router.post("/refreshToken", refreshToken);
router.post("/deactivate_account", authUser, deactivateAccount);

module.exports = router;
