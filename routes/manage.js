const express = require("express");
const path = require("path");
const fs = require("fs");
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
  createImage,
  completeVideoUpload,
  uploadVideoChunk,
  cancelVideoUpload,
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

const storageChunks = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadId = req.body.uploadId;
    if (!uploadId) return cb(new Error("uploadId is required"));

    const dir = path.join(__dirname, "../temp/chunks", uploadId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // pad เลขให้เรียง lexicographically ตรงกับลำดับ chunk จริง (chunk_000000, chunk_000001, ...)
    const chunkIndex = String(req.body.chunkIndex).padStart(6, "0");
    cb(null, `chunk_${chunkIndex}`);
  },
});

const uploadChunk = multer({
  storage: storageChunks,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB ต่อ chunk (เผื่อ margin จาก 8MB ที่ frontend หั่นจริง)
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

router.post(
  "/manage/create-url-image",
  authAdmin,
  uploadImages.single("image"),
  createImage,
);

router.post("/manage/delete_videos", authAdmin, deleteOldVideo);
router.post("/manage/delete_Image", authAdmin, deleteOldImage);

// ----------- new route api -----------
router.post(
  "/manage/upload-video-chunk",
  authAdmin, // ใช้ middleware ตัวเดิมของโปรเจกต์คุณ (import ให้ตรง path จริง)
  uploadChunk.single("chunk"),
  uploadVideoChunk,
);

router.post("/manage/complete-video-upload", authAdmin, completeVideoUpload);
router.post("/manage/cancel-upload", cancelVideoUpload);

module.exports = router;
