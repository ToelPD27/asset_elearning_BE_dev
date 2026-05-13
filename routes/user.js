const express = require("express");
const {
  getCourse,
  register,
  enrollments,
  syncUser,
  getCategories,
  updateStudentProgress,
  getProgress,
  getProgressCourse,
  edit_profile,
  uploadImage,
  registerGoogle,
  registerApple,
  getLastWatching,
  updateLearningStatus,
} = require("../controller/user.js");
const { authUser, identifyUser } = require("../middleware/auth.js");

const router = express.Router();
const multer = require("multer");

// 1. ตั้งค่า Multer สำหรับพักไฟล์ใน Memory (ไม่เซฟลงเครื่อง server)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // จำกัดขนาดไว้ที่ 500MB (ปรับเพิ่มได้)
});

router.get("/getCourse", identifyUser, getCourse);
router.post("/register", register);
router.post("/register_google", registerGoogle);
router.post("/register_apple", registerApple);
router.post("/enrollments", authUser, enrollments);
router.post("/syncUser", authUser, syncUser);
router.get("/categories", getCategories);
router.post("/updateStudentProgress", authUser, updateStudentProgress);
router.post("/getProgress", authUser, getProgress);
router.post("/getProgressCourse", authUser, getProgressCourse);
router.post("/edit_profile/:user_id", authUser, edit_profile);
router.post("/uploadImages", authUser, upload.single("image"), uploadImage);
router.post("/getLastWhatching", authUser, getLastWatching);
router.post("/updateLearningStatus", authUser, updateLearningStatus);

module.exports = router;
