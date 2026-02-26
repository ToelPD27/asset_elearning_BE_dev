const express = require("express");
const { streamVideosServer } = require("../controller/orther");
const router = express.Router();

router.post("/streamVideosServer", streamVideosServer);

module.exports = router;
