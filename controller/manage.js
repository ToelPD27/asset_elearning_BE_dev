const {
  User,
  Category,
  Course,
  Station,
  Enrollment,
} = require("../model/index.js");
const { Op } = require("sequelize");
const { Upload } = require("@aws-sdk/lib-storage");
const r2 = require("../libs/r2Client.js");
const fs = require("fs");
const path = require("path");
const {
  PutObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} = require("@aws-sdk/client-s3");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const crypto = require("crypto"); // เพิ่มตัวนี้เพื่อสร้างกุญแจสุ่ม
ffmpeg.setFfmpegPath(ffmpegPath);

let progressClients = [];

const uploadLargeVideo = async (req, res) => {
  const file = req.file;
  const { course_id } = req.body;

  if (!file) return res.status(400).json({ message: "ไม่พบไฟล์วิดีโอ" });
  if (!course_id)
    return res.status(400).json({ message: "กรุณาระบุ course_id" });

  const originalname = file.originalname.split(".").slice(0, -1).join(".");
  const safeName = originalname.replace(/[^a-z0-9]/gi, "_").toLowerCase();

  const now = new Date();
  const dateStr = `${String(now.getDate()).padStart(2, "0")}${String(now.getMonth() + 1).padStart(2, "0")}${now.getFullYear()}`;
  const timeStr = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const folderName = `${course_id}_${dateStr}_${timeStr}`;

  console.log("Generated Folder Name:", folderName);
  console.log(
    `--- Processing HLS for Course: ${folderName} | Video: ${safeName} ---`,
  );

  const startTime = Date.now();
  const courseTempParent = path.join(__dirname, "../temp");
  const folderNameDir = path.join(courseTempParent, folderName);
  const tempDir = path.join(folderNameDir, safeName);

  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tempDir, { recursive: true });

  const inputPath = file.path;
  const m3u8Path = path.join(tempDir, "index.m3u8");

  try {
    const key = crypto.randomBytes(16);
    const keyFileName = "video.key";
    const keyFilePath = path.join(tempDir, keyFileName);
    fs.writeFileSync(keyFilePath, key);
    const keyUrlForPlayer = `${process.env.R2_PUBLIC_URL}/get-key?key=videos/${folderName}/${safeName}/${keyFileName}`;
    const absoluteKeyPath = path.resolve(keyFilePath);
    const formattedKeyPath = absoluteKeyPath.replace(/\\/g, "/");
    const keyInfoContent = `${keyUrlForPlayer}\n${formattedKeyPath}\n\n`;

    const keyInfoPath = path.resolve(tempDir, "key_info.file");

    console.log("--- Debug Key Info ---");
    console.log("Key URL:", keyUrlForPlayer);
    console.log("Local Key Path:", formattedKeyPath);
    console.log("Key Info File Path:", keyInfoPath);
    console.log("----------------------");

    fs.writeFileSync(keyInfoPath, keyInfoContent, "utf8");

    ffmpeg(inputPath)
      .outputOptions([
        "-c:v libx264",
        "-profile:v main",
        "-level 3.1",
        "-pix_fmt yuv420p",
        "-c:a aac",
        "-start_number 0",
        "-hls_time 10",
        "-hls_list_size 0",
        "-f hls",
        "-hls_key_info_file",
        keyInfoPath.replace(/\\/g, "/"),
      ])
      .output(m3u8Path)
      .on("end", async () => {
        console.log(`✅ HLS Generated. Starting Sequential Upload to R2...`);

        const generatedFiles = fs.readdirSync(tempDir);
        const totalFiles = generatedFiles.length;
        let uploadedCount = 0;

        try {
          for (const fileName of generatedFiles) {
            // ข้ามไฟล์ key_info.file ไม่ต้องอัปโหลดขึ้น R2 (ใช้แค่ตอน Encode)
            if (fileName === "key_info.file") {
              uploadedCount++; // นับเพิ่มเพื่อให้ progress ครบ 100%
              continue;
            }

            const filePath = path.join(tempDir, fileName);
            const fileStream = fs.createReadStream(filePath);

            const parallelUploads3 = new Upload({
              client: r2,
              params: {
                Bucket: process.env.R2_BUCKET_NAME,
                Key: `videos/${folderName}/${safeName}/${fileName}`,
                Body: fileStream,
                ContentType: fileName.endsWith(".m3u8")
                  ? "application/x-mpegURL"
                  : fileName.endsWith(".key")
                    ? "application/octet-stream"
                    : "video/MP2T",
              },
              partSize: 1024 * 1024 * 10,
              leavePartsOnError: false,
            });

            parallelUploads3.on("httpUploadProgress", (progress) => {
              const totalPercent = Math.round(
                ((uploadedCount + progress.loaded / progress.total) /
                  totalFiles) *
                  100,
              );

              const progressData = JSON.stringify({
                totalPercent,
                currentFile: fileName,
                fileIndex: uploadedCount + 1,
                totalFiles,
              });

              progressClients.forEach((client) => {
                client.res.write(`data: ${progressData}\n\n`);
              });

              process.stdout.write(`    🚀 Progress: ${totalPercent}% \r`);
            });

            await parallelUploads3.done();
            uploadedCount++;
          }

          console.log(`\n✅ All files uploaded successfully!`);

          // --- Cleanup ---
          fs.rmSync(tempDir, { recursive: true, force: true });
          if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);

          const duration = ((Date.now() - startTime) / 1000).toFixed(2);

          // เตรียมข้อมูลสำหรับ Return
          const finalPlaylistUrl = `${process.env.R2_PUBLIC_URL}/videos/${folderName}/${safeName}/index.m3u8`;
          const finalKeyUrl = `${process.env.R2_PUBLIC_URL}/get-key?key=videos/${folderName}/${safeName}/${keyFileName}`;

          if (!res.headersSent) {
            return res.status(200).json({
              message: "อัปโหลดและเข้ารหัสวิดีโอเรียบร้อยแล้ว",
              data: {
                video_name: originalname,
                url: finalPlaylistUrl,
                key_url: finalKeyUrl,
                type: "hls",
                is_encrypted: true,
                duration: duration, // วินาที (ถ้าต้องการ hh:mm:ss ต้องใช้ ffprobe เพิ่ม)
              },
            });
          }
        } catch (uploadError) {
          console.error("\n❌ R2 Upload Error:", uploadError);
          // Cleanup logic...
          if (fs.existsSync(courseTempParent))
            fs.rmSync(courseTempParent, { recursive: true, force: true });
          if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
          if (!res.headersSent)
            return res.status(500).json({
              message: "Storage Upload Failed",
              error: uploadError.message,
            });
        }
      })
      .on("error", (err) => {
        console.error("❌ FFmpeg Error:", err);
        if (fs.existsSync(courseTempParent))
          fs.rmSync(courseTempParent, { recursive: true, force: true });
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (!res.headersSent)
          return res
            .status(500)
            .json({ message: "FFmpeg Error", error: err.message });
      })
      .run();
  } catch (error) {
    console.error("❌ System Error:", error);
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (!res.headersSent)
      return res.status(500).json({ message: "Internal Error" });
  }
};

const uploadVideo = async (req, res) => {
  console.log("--- New Upload Request ---");
  console.log("File received:", req.file ? "YES" : "NO");
  try {
    const file = req.file;
    if (!file) {
      console.log("\x1b[33m%s\x1b[0m", "Warning: No file in req.file");
      return res.status(400).json({ message: "กรุณาเลือกไฟล์วิดีโอ" });
    }
    if (!file) {
      return res.status(400).json({ message: "กรุณาเลือกไฟล์วิดีโอ" });
    }

    // สร้างชื่อไฟล์ใหม่: videos/1712345678-name.mp4
    const fileName = `videos/${file.originalname}`;

    const uploadParams = {
      Bucket: process.env.R2_BUCKET_NAME,
      Key: `${fileName}`,
      Body: file.buffer, // ข้อมูลไฟล์จาก memoryStorage
      ContentType: file.mimetype,
    };

    // ส่งไฟล์ไป Cloudflare R2
    await r2.send(new PutObjectCommand(uploadParams));

    // ส่ง URL และข้อมูลกลับไปที่ Frontend
    res.status(200).json({
      message: "อัปโหลดวิดีโอสำเร็จ!",
      url: `${process.env.R2_PUBLIC_URL}/${fileName}`,
      fileName: fileName,
    });
  } catch (error) {
    console.error("Upload Controller Error:", error);
    res.status(500).json({
      message: "เกิดข้อผิดพลาดในการอัปโหลด",
      error: error.message,
    });
  }
};

// Endpoint สำหรับให้ Frontend มาเกาะเพื่อฟัง Progress
const subscribeProgress = (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // เก็บการเชื่อมต่อไว้
  const clientId = Date.now();
  const newClient = { id: clientId, res };
  progressClients.push(newClient);

  // ถ้าปิดหน้าเว็บ ให้ลบออก
  req.on("close", () => {
    progressClients = progressClients.filter((c) => c.id !== clientId);
  });
};

const newCourse = async (req, res) => {
  try {
    const { course_name, category_id, fee, detail, image } = req.body;

    // 1. ตรวจสอบข้อมูลที่จำเป็น
    if (!course_name || !category_id) {
      return res.status(400).json({
        success: false,
        message: "กรุณาระบุชื่อคอร์สและหมวดหมู่",
      });
    }

    // 2. Logic การสร้าง course_id (ตัวอย่าง: CRSตามด้วยลำดับล่าสุด)
    const lastCourse = await Course.findOne({
      order: [["id", "DESC"]],
    });

    let nextId = 1;
    if (lastCourse) {
      // ดึงตัวเลขจาก CRS001 มาบวกเพิ่ม
      const lastIdNum = parseInt(lastCourse.course_id.split("CRS")[1]);
      nextId = lastIdNum + 1;
    }
    const generatedCourseId = `CRS${nextId.toString().padStart(3, "0")}`;

    // 3. บันทึกลงฐานข้อมูล
    const course = await Course.create({
      course_id: generatedCourseId,
      course_name,
      category_id,
      fee: fee || 0.0,
      detail,
      image,
      count: 0, // กำหนดเป็น 0 ตามที่คุณต้องการ (ใน Model มี defaultValue แล้วแต่ใส่ไว้เพื่อความชัวร์)
    });

    res.status(201).json({
      success: true,
      message: "สร้างคอร์สใหม่สำเร็จ",
      data: course,
    });
  } catch (error) {
    console.error("Create Course Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์",
      error: error.message,
    });
  }
};

const UpdateCourse = async (req, res) => {
  try {
    // รับ course_id จาก params หรือ body ก็ได้ (แนะนำ params สำหรับความชัดเจน)
    const { course_id } = req.params;
    const { course_name, category_id, fee, detail, image } = req.body;

    // 1. ค้นหาคอร์สที่ต้องการอัปเดต
    const course = await Course.findOne({
      where: { course_id: course_id },
    });

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบข้อมูลคอร์สที่ต้องการแก้ไข",
      });
    }

    // 2. ทำการอัปเดตข้อมูล (อัปเดตเฉพาะค่าที่มีการส่งมา)
    await course.update({
      course_name: course_name || course.course_name,
      category_id: category_id || course.category_id,
      fee: fee !== undefined ? fee : course.fee,
      detail: detail !== undefined ? detail : course.detail,
      image: image || course.image,
    });

    res.status(200).json({
      success: true,
      message: "อัปเดตข้อมูลคอร์สสำเร็จ",
      data: course,
    });
  } catch (error) {
    console.error("Update Course Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์",
      error: error.message,
    });
  }
};

const AddStation = async (req, res) => {
  try {
    const { course_id } = req.params;
    const { station_name, videos } = req.body;

    // --- ส่วนที่แก้ไข: แปลง JSON String กลับเป็น Array Object ---
    let parsedVideos = videos;
    if (typeof videos === "string") {
      try {
        parsedVideos = JSON.parse(videos);
      } catch (e) {
        console.error("JSON Parse Error:", e);
        return res.status(400).json({ message: "Invalid videos format" });
      }
    }
    // ---------------------------------------------------

    const parentCourse = await Course.findOne({
      where: { course_id: course_id },
    });

    if (!parentCourse) {
      return res.status(404).json({ message: "Course not found." });
    }

    const lastStation = await Station.findOne({
      where: {
        station_id: { [Op.like]: "STN%" },
      },
      order: [["station_id", "DESC"]],
    });

    let newStationId = "STN001";
    if (lastStation) {
      const lastIdNumber = parseInt(lastStation.station_id.replace("STN", ""));
      const nextIdNumber = lastIdNumber + 1;
      newStationId = `STN${nextIdNumber.toString().padStart(3, "0")}`;
    }

    const station = await Station.create({
      station_id: newStationId,
      course_id,
      station_name,
      videos: parsedVideos, // ใช้ข้อมูลที่ Parse แล้วที่นี่
    });

    return res.status(201).json({
      message: "Station added successfully",
      data: station,
    });
  } catch (error) {
    console.error("Error in AddStation:", error);
    return res.status(500).json({
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const Update_Station = async (req, res) => {
  try {
    const { course_id, station_id } = req.params;
    const { videos, station_name } = req.body; // รับ station_name มาด้วยเผื่อมีการแก้ไขชื่อ

    const station = await Station.findOne({
      where: { course_id, station_id },
    });

    if (!station) {
      return res.status(404).json({ message: "ไม่พบบทเรียนนี้" });
    }

    // ❌ เดิม: currentVideos = [...currentVideos, ...videos]; (นี่คือสาเหตุที่มันเบิ้ล)

    // ✅ ใหม่: แทนที่ด้วยข้อมูลที่ส่งมาจาก Frontend โดยตรง
    if (Array.isArray(videos)) {
      station.videos = videos;
    } else if (videos && typeof videos === "object") {
      station.videos = [videos]; // กรณีส่งมาตัวเดียวให้หุ้มด้วย Array
    }

    // อัปเดตชื่อบทเรียนด้วย (ถ้ามีส่งมา)
    if (station_name) {
      station.station_name = station_name;
    }

    // บอก Sequelize ว่าฟิลด์ JSON มีการเปลี่ยนแปลง
    station.changed("videos", true);

    await station.save();

    return res.status(200).json({
      message: "อัปเดตข้อมูลบทเรียนเรียบร้อยแล้ว",
      total_videos: station.videos.length,
      data: station,
    });
  } catch (error) {
    return res.status(500).json({ message: "Error", error: error.message });
  }
};

const deleteCourse = async (req, res) => {
  try {
    const { course_id } = req.params;
    const course = await Course.findOne({ where: { course_id } });
    if (!course) {
      return res.status(404).json({ message: "Course not found." });
    }
    await Course.destroy({ where: { course_id } });

    await Station.destroy({ where: { course_id } });
    res.status(200).json({ message: "Course deleted successfully." });
  } catch (error) {
    console.error("Error deleting course:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

const deleteStation = async (req, res) => {
  try {
    const { station_id } = req.params;

    const station = await Station.findOne({ where: { station_id } });
    if (!station) {
      return res.status(404).json({ message: "Station not found." });
    }
    await Station.destroy({ where: { station_id } });
    res.status(200).json({ message: "Station deleted successfully." });
  } catch {
    console.error("Error deleting Station:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};

const get_enrollment = async (req, res) => {
  try {
    // ดึงข้อมูลทั้งหมดจาก Table Enrollment
    const enrollments = await Enrollment.findAll({
      include: [
        {
          model: User,
          as: "user",
          attributes: ["first_name", "last_name", "email"],
        },
        {
          model: Course,
          as: "course", // ตรวจสอบว่าใน Associate ตั้งชื่อ Alias เป็นตัวใหญ่หรือเล็ก
          attributes: ["course_name"], // เลือกดึงเฉพาะที่ต้องการโชว์ในตาราง
        },
      ],
      order: [["createdAt", "DESC"]], // (แนะนำ) เรียงลำดับรายการใหม่ล่าสุดขึ้นก่อน
    });

    // ตรวจสอบว่ามีข้อมูลหรือไม่
    if (enrollments.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No enrollment records found.",
        data: [],
      });
    }

    // ส่งข้อมูลกลับไปหา Client
    return res.status(200).json({
      success: true,
      count: enrollments.length,
      data: enrollments,
    });
  } catch (error) {
    // จัดการกรณีเกิด Error เช่น Database เชื่อมต่อไม่ได้
    console.error("Error fetching all enrollments:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const update_enroll = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, cancel_reason } = req.body; // 1. รับ cancel_reason เพิ่มจาก body

    // 2. ตรวจสอบ status
    const validStatuses = ["pending", "success", "cancelled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status.",
      });
    }

    // 3. ค้นหารายการ
    const enrollment = await Enrollment.findByPk(id);
    if (!enrollment) {
      return res.status(404).json({
        success: false,
        message: "Enrollment record not found.",
      });
    }

    // 4. อัปเดตข้อมูล
    enrollment.status = status;

    // บันทึกเหตุผลการยกเลิก (ถ้ามีส่งมา)
    // หรืออาจจะล้างค่าทิ้งถ้าเปลี่ยนสถานะกลับไปเป็น success/pending
    if (status === "cancelled") {
      enrollment.cancel_reason = cancel_reason || "ไม่ได้ระบุเหตุผล";
    } else {
      enrollment.cancel_reason = null; // ล้างข้อความแจ้งเตือนถ้าสถานะไม่ใช่การยกเลิก
    }

    await enrollment.save();

    return res.status(200).json({
      success: true,
      message: `Enrollment updated to ${status} successfully.`,
      data: enrollment,
    });
  } catch (error) {
    console.error("Error updating enrollment:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const update_status_course = async (req, res) => {
  try {
    const { course_id } = req.params;
    const { status } = req.body;

    // 1. ตรวจสอบเบื้องต้นว่าค่า status ที่ส่งมาถูกต้องตาม ENUM หรือไม่
    const validStatuses = ["active", "pending", "maintenance", "inactive"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        status: "fail",
        message: "สถานะไม่ถูกต้อง",
      });
    }

    // 2. อัปเดตข้อมูลลงฐานข้อมูลด้วย Sequelize
    const updated = await Course.update(
      { status: status },
      { where: { course_id: course_id } },
    );

    // 3. เช็คว่ามีแถวที่ถูกอัปเดตจริงไหม
    if (updated[0] === 0) {
      return res.status(404).json({
        status: "fail",
        message: "ไม่พบข้อมูลคอร์สที่ต้องการอัปเดต",
      });
    }

    // 4. ส่งคำตอบกลับเมื่อสำเร็จ
    res.status(200).json({
      status: "success",
      message: `อัปเดตสถานะเป็น ${status} เรียบร้อยแล้ว`,
    });
  } catch (err) {
    console.error("❌ Update Status Course Error:", err);
    res.status(500).json({
      status: "error",
      message: "Internal Server Error",
    });
  }
};

const deleteOldVideo = async (req, res) => {
  try {
    const { url_OldKey } = req.body;

    if (!url_OldKey) {
      return res.status(400).json({ message: "ไม่พบ URL ที่ต้องการลบ" });
    }

    const urlObj = new URL(url_OldKey);
    let fullPath = decodeURIComponent(urlObj.pathname.substring(1));

    // --- ส่วนที่ปรับปรุง: ดึงเอาเฉพาะโฟลเดอร์ออกมา ---
    // ไม่ว่า URL จะจบด้วย / หรือ index.m3u8
    // โค้ดนี้จะเอาเฉพาะ Path ของ Folder มาให้เสมอ
    let folderPrefix = fullPath;
    if (fullPath.includes(".")) {
      folderPrefix = path.dirname(fullPath);
    }

    // ตรวจสอบให้แน่ใจว่า Prefix ลงท้ายด้วย / เพื่อลบทุกอย่างข้างใน
    if (!folderPrefix.endsWith("/")) {
      folderPrefix += "/";
    }

    console.log("🎯 Target Prefix to delete:", folderPrefix);

    const listParams = {
      Bucket: process.env.R2_BUCKET_NAME,
      Prefix: folderPrefix,
    };

    const listedObjects = await r2.send(new ListObjectsV2Command(listParams));

    if (!listedObjects.Contents || listedObjects.Contents.length === 0) {
      return res
        .status(200)
        .json({ message: "ไม่พบไฟล์ หรือลบไปก่อนหน้าแล้ว" });
    }

    // เตรียมรายการไฟล์ (Batch Delete)
    const deleteParams = {
      Bucket: process.env.R2_BUCKET_NAME,
      Delete: {
        Objects: listedObjects.Contents.map(({ Key }) => ({ Key })),
        Quiet: true, // ลด Payload ขาตอบกลับเพื่อความเร็ว
      },
    };

    await r2.send(new DeleteObjectsCommand(deleteParams));

    console.log(
      `--- Folder ${folderPrefix} deleted (${listedObjects.Contents.length} files) ---`,
    );

    if (res) {
      res.status(200).json({
        message: "ลบโฟลเดอร์สำเร็จ",
        deletedCount: listedObjects.Contents.length,
        path: folderPrefix,
      });
    }
  } catch (err) {
    console.error("Delete Error:", err);
    if (res) {
      res.status(500).json({ message: "ระบบลบขัดข้อง", error: err.message });
    }
  }
};

const uploadImage = async (req, res) => {
  console.log("--- Starting Image Upload ---");
  const startTime = Date.now();

  const file = req.file;
  // 1. ตรวจสอบไฟล์และประเภทไฟล์ (Validation)
  if (!file) {
    console.error("❌ [Upload Error] No file received");
    return res.status(400).json({ message: "กรุณาเลือกรูปภาพ" });
  }

  if (!file.mimetype.startsWith("image/")) {
    return res
      .status(400)
      .json({ message: "กรุณาอัปโหลดไฟล์ประเภทรูปภาพเท่านั้น" });
  }

  console.log(
    `📦 Image received: ${file.originalname} (${(file.size / 1024).toFixed(2)} KB)`,
  );

  // ตั้งชื่อไฟล์ใหม่ (แนะนำให้ใส่ Timestamp เพื่อป้องกันชื่อซ้ำ)
  const fileExtension = file.originalname.split(".").pop();
  const fileName = `images/${Date.now()}-${Math.round(Math.random() * 1e9)}.${fileExtension}`;
  const filePath = file.path;

  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found on disk at ${filePath}`);
    }

    const fileStream = fs.createReadStream(filePath);

    // ใช้ Upload สำหรับ R2 (S3 Compatible)
    const parallelUploads3 = new Upload({
      client: r2,
      params: {
        Bucket: process.env.R2_BUCKET_NAME,
        Key: fileName,
        Body: fileStream,
        ContentType: file.mimetype,
        // สำหรับรูปภาพที่ต้องการให้เปิดดูได้ทันทีผ่าน URL
        ACL: "public-read",
      },
      // สำหรับรูปภาพ ไม่ต้องใช้ Queue เยอะ
      queueSize: 4,
      partSize: 5 * 1024 * 1024, // 5MB
    });

    // ส่วน Progress (ถ้ารูปเล็กมากอาจจะวิ่งไป 100% ทันที)
    parallelUploads3.on("httpUploadProgress", (progress) => {
      if (progress.total) {
        const percentage = Math.round((progress.loaded / progress.total) * 100);

        // ส่ง Progress ไปยัง Clients (ถ้ามีระบบ SSE)
        if (typeof progressClients !== "undefined") {
          progressClients.forEach((client) => {
            client.res.write(`data: ${JSON.stringify({ percentage })}\n\n`);
          });
        }
      }
    });

    console.log("⏳ Uploading image to R2...");
    await parallelUploads3.done();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Image upload finished in ${duration}s`);

    // ส่ง URL กลับไปให้ Frontend
    res.status(200).json({
      message: "อัปโหลดรูปภาพสำเร็จ!",
      url: `${process.env.R2_PUBLIC_URL}/${fileName}`,
      fileName: fileName,
    });

    // ลบไฟล์ชั่วคราวออกจาก Server หลังอัปโหลดเสร็จ
    fs.unlink(filePath, (err) => {
      if (err) console.error("Cleanup Error:", err);
    });
  } catch (error) {
    console.error("❌ [Critical Image Upload Error]:", error);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    res.status(500).json({
      message: "เกิดข้อผิดพลาดในการอัปโหลดรูปภาพ",
      error: error.message,
    });
  }
};

const deleteOldImage = async (req, res) => {
  try {
    const { url_OldKey } = req.body; // รับค่า: https://pub-.../videos/EP1%20The%20...mp4

    if (!url_OldKey) {
      return res.status(400).json({ message: "ไม่พบ URL ที่ต้องการลบ" });
    }

    const urlObj = new URL(url_OldKey);
    const fileKey = decodeURIComponent(urlObj.pathname.substring(1));
    console.log("🎯 Target Key to delete:", fileKey);

    const deleteParams = {
      Bucket: process.env.R2_BUCKET_NAME,
      Key: fileKey,
    };

    await r2.send(new DeleteObjectCommand(deleteParams));

    console.log("--- Old file deleted from R2 successfully ---");

    if (res) {
      res.status(200).json({ message: "ลบไฟล์เก่าสำเร็จ", key: fileKey });
    }
  } catch (err) {
    console.error("Delete Error:", err);
    if (res) {
      res
        .status(500)
        .json({ message: "ไม่สามารถลบไฟล์ได้", error: err.message });
    }
  }
};

module.exports = {
  uploadVideo,
  uploadImage,
  newCourse,
  UpdateCourse,
  AddStation,
  Update_Station,
  deleteCourse,
  get_enrollment,
  update_enroll,
  uploadLargeVideo,
  subscribeProgress,
  update_status_course,
  deleteOldVideo,
  deleteOldImage,
  deleteStation,
};
