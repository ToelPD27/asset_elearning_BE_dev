const express = require("express");
const {
  streamclientServer,
  sendPushNotification,
  getNotificationsByUserId,
  updateReadingStatus,
  sendOTP,
  create_checkout_session,
  // forgetPassword,
} = require("../controller/orther");
const router = express.Router();

router.post("/streamclientServer", streamclientServer);

router.post("/sendPushNotification", sendPushNotification);

router.get("/getNotificationsByUserId/:user_id", getNotificationsByUserId);

router.post("/updateReadingStatus", updateReadingStatus);

router.post("/send-otp", sendOTP);

router.post("/create_checkout_session", create_checkout_session);

// router.post("/forgetPassword", forgetPassword);

module.exports = router;
