const express = require("express");
const {
  streamclientServer,
  sendPushNotification,
  getNotificationsByUserId,
  updateReadingStatus,
} = require("../controller/orther");
const router = express.Router();

router.post("/streamclientServer", streamclientServer);

router.post("/sendPushNotification", sendPushNotification);

router.get("/getNotificationsByUserId/:user_id", getNotificationsByUserId);

router.post("/updateReadingStatus", updateReadingStatus);

module.exports = router;
