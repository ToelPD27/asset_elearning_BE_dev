const express = require("express");
const path = require("path");
const { authAdmin } = require("../middleware/auth.js");
const {
  newCourse,
  AddStation,
  Update_Station,
  UpdateCourse,
  deleteCourse,
  uploadVideo,
  uploadImage,
  get_enrollment,
  update_enroll,
  uploadLargeVideo,
  subscribeProgress,
  update_status_course,
  deleteOldVideo,
  deleteOldImage,
  deleteStation,
} = require("../controller/manage.js");

const router = express.Router();
const multer = require("multer");

// 1. ตั้งค่า Multer สำหรับพักไฟล์ใน Memory (ไม่เซฟลงเครื่อง server)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // จำกัดขนาดไว้ที่ 500MB (ปรับเพิ่มได้)
});

// ตั้งค่าที่เก็บไฟล์ชั่วคราวบน Server
const storagelageVideos = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // ต้องสร้างโฟลเดอร์ uploads รอไว้ด้วย
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const uploadlageVideo = multer({
  storage: storagelageVideos,
  limits: { fileSize: 4 * 1024 * 1024 * 1024 }, // 4 GB (4,294,967,296 bytes)
});

const storageImage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // ต้องสร้างโฟลเดอร์ uploads รอไว้ด้วย
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const uploadImages = multer({
  storage: storageImage,
  limits: { fileSize: 4 * 1024 * 1024 * 1024 }, // 4 GB (4,294,967,296 bytes)
});

router.post("/manage/newCourse", authAdmin, newCourse);
router.post("/manage/addStation/:course_id", authAdmin, AddStation);
router.post(
  "/manage/updateStation/:course_id/:station_id",
  authAdmin,
  Update_Station,
);
router.post("/manage/updateCourse/:course_id", authAdmin, UpdateCourse);
router.post("/manage/upload", authAdmin, upload.single("video"), uploadVideo);
router.post(
  "/manage/uploadImage",
  authAdmin,
  uploadImages.single("image"),
  uploadImage,
);
router.post(
  "/manage/upload-lage-video",
  authAdmin,
  uploadlageVideo.single("video"),
  uploadLargeVideo,
);
router.delete("/manage/deleteCourse/:course_id", authAdmin, deleteCourse);
router.delete("/manage/deleteStation/:station_id", authAdmin, deleteStation);
router.get("/get_enrollments", authAdmin, get_enrollment);
router.post("/updateEmroll/:id", authAdmin, update_enroll);
router.get("/upload/subscribeProgress", subscribeProgress);
router.post(
  "/manage/update_status_course/:course_id",
  authAdmin,
  update_status_course,
);

router.post("/manage/delete_videos", authAdmin, deleteOldVideo);
router.post("/manage/delete_videos", authAdmin, deleteOldImage);

module.exports = router;
