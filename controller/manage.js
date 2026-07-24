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

const CHUNK_ROOT = path.join(__dirname, "../temp/chunks");
const MERGED_ROOT = path.join(__dirname, "../temp/merged");
const ENCODE_ROOT = path.join(__dirname, "../temp/encode");

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
  const { uploadId } = req.query; // 👈 เพิ่ม 1: รับ uploadId จาก query string
  if (!uploadId) {
    return res.status(400).json({ message: "ต้องระบุ uploadId" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // บอก Nginx อย่า buffer

  // ตั้ง CORS ให้ route นี้แบบชัดเจน อย่าพึ่ง middleware กลางอย่างเดียว
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  res.flushHeaders();

  const clientId = Date.now();
  const newClient = { id: clientId, uploadId, res }; // 👈 เพิ่ม 2: เก็บ uploadId ไว้ในตัว client
  progressClients.push(newClient);

  // Heartbeat กัน connection ถูกตัดตอนไม่มี event ส่ง
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
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

const createImage = async (req, res) => {
  try {
    if (!req.body || !req.body.image) {
      return res.status(400).json({ error: "No image field in request body" });
    }

    let base64Data = req.body.image;
    let originalName = req.body.fileName;

    if (!originalName) {
      return res.status(400).json({ error: "No fileName provided" });
    }

    // ✅ sanitize ชื่อไฟล์
    originalName = path.basename(originalName).replace(/\s+/g, "_");

    // ✅ ตัดนามสกุลเก่าออก แล้วใส่ .webp
    const baseName = path.parse(originalName).name;
    const finalName = `${baseName}.webp`;

    // ✅ decode base64
    if (base64Data.includes(",")) {
      base64Data = base64Data.split(",")[1];
    }
    const imageBuffer = Buffer.from(base64Data, "base64");

    const uploadDir = "/var/www/asset-elearning-images/images";
    const filePath = path.join(uploadDir, finalName);

    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    fs.writeFileSync(filePath, imageBuffer);

    const fileUrl = `https://asset-image.uniquecarestationthailand.com/images/${finalName}`;
    return res.json({
      message: "อัปโหลดรูปภาพสำเร็จ!",
      url: fileUrl,
      fileName: finalName,
    });
  } catch (err) {
    console.error("🔥 Unexpected error:", err);
    return res
      .status(500)
      .json({ error: "Unexpected server error", details: err.message });
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

// ------------------ new function --------------------

const broadcastProgress = (uploadId, payload) => {
  progressClients
    .filter((c) => c.uploadId === uploadId)
    .forEach((c) => c.res.write(`data: ${JSON.stringify(payload)}\n\n`));
};

const uploadVideoChunk = async (req, res) => {
  try {
    const { uploadId, chunkIndex, totalChunks } = req.body;

    if (!uploadId || chunkIndex === undefined || !totalChunks) {
      return res.status(400).json({ message: "ข้อมูล chunk ไม่ครบถ้วน" });
    }

    return res.status(200).json({
      message: "รับ chunk สำเร็จ",
      chunkIndex: Number(chunkIndex),
    });
  } catch (err) {
    console.error("Chunk Upload Error:", err);
    return res.status(500).json({ message: "อัปโหลด chunk ไม่สำเร็จ" });
  }
};

// ---------- 2) รวม chunk เป็นไฟล์เดียว แล้วยิงเข้า pipeline เดิม ----------
const completeVideoUpload = async (req, res) => {
  const { uploadId, fileName, course_id, totalChunks } = req.body;

  if (!uploadId || !fileName || !course_id || !totalChunks) {
    return res.status(400).json({ message: "ข้อมูลไม่ครบถ้วน" });
  }

  const chunkDir = path.join(CHUNK_ROOT, uploadId);
  fs.mkdirSync(MERGED_ROOT, { recursive: true });
  const mergedPath = path.join(MERGED_ROOT, `${uploadId}_${fileName}`);

  try {
    if (!fs.existsSync(chunkDir)) {
      return res
        .status(400)
        .json({ message: "ไม่พบ chunk ของไฟล์นี้ อาจหมดอายุหรือถูกลบไปแล้ว" });
    }

    // ชื่อไฟล์ chunk ถูก pad เลขไว้ตอนอัปโหลด (chunk_000000, chunk_000001, ...) sort แล้วได้ลำดับถูกต้อง
    const chunkFiles = fs.readdirSync(chunkDir).sort();
    if (chunkFiles.length !== Number(totalChunks)) {
      return res.status(400).json({
        message: `ได้รับ chunk ไม่ครบ (${chunkFiles.length}/${totalChunks}) กรุณาอัปโหลดใหม่`,
      });
    }

    // รวม chunk ตามลำดับให้เป็นไฟล์วิดีโอต้นฉบับไฟล์เดียว
    await new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(mergedPath);
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);

      (async () => {
        try {
          for (const chunkFile of chunkFiles) {
            const chunkPath = path.join(chunkDir, chunkFile);
            await new Promise((res2, rej2) => {
              const readStream = fs.createReadStream(chunkPath);
              readStream.on("error", rej2);
              readStream.on("end", res2);
              readStream.pipe(writeStream, { end: false });
            });
          }
          writeStream.end();
        } catch (err) {
          reject(err);
        }
      })();
    });

    // ลบโฟลเดอร์ chunk ทิ้งทันทีหลังรวมไฟล์เสร็จ ไม่ต้องรอ
    fs.rmSync(chunkDir, { recursive: true, force: true });

    res
      .status(202)
      .json({ message: "รับไฟล์ครบแล้ว กำลังประมวลผลเบื้องหลัง", uploadId });

    processVideoToHLS(mergedPath, fileName, course_id, uploadId)
      .then((result) =>
        broadcastProgress(uploadId, {
          status: "done",
          totalPercent: 100,
          data: result,
        }),
      )
      .catch((err) =>
        broadcastProgress(uploadId, { status: "error", message: err.message }),
      );
  } catch (err) {
    console.error("❌ Complete Upload Error:", err);
    if (fs.existsSync(chunkDir))
      fs.rmSync(chunkDir, { recursive: true, force: true });
    if (fs.existsSync(mergedPath)) fs.unlinkSync(mergedPath);
    return res.status(500).json({
      message: "ไม่สามารถประมวลผลวิดีโอได้",
      error: err.message,
    });
  }
};

const activeJobs = new Map();

// ---------- 3) Pipeline เดิม (คัดลอกมาจาก uploadLargeVideo เดิมของคุณ) -----------
// ต่างจากเดิมตรงที่รับ "path ของไฟล์ที่รวมเสร็จแล้ว" แทนที่จะรับ req.file ตรงๆ
// เพื่อให้ทั้ง flow เดิม (ถ้ายังอยากเก็บไว้) และ flow ใหม่ (จาก chunk) ใช้ฟังก์ชันเดียวกันได้
const processVideoToHLS = (
  inputPath,
  originalFileName,
  course_id,
  uploadId,
) => {
  return new Promise((resolve, reject) => {
    const originalname = originalFileName.split(".").slice(0, -1).join(".");
    const safeName = originalname.replace(/[^a-z0-9]/gi, "_").toLowerCase();

    const now = new Date();
    const dateStr = `${String(now.getDate()).padStart(2, "0")}${String(now.getMonth() + 1).padStart(2, "0")}${now.getFullYear()}`;
    const timeStr = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    const folderName = `${course_id}_${dateStr}_${timeStr}`;

    const startTime = Date.now();
    const folderNameDir = path.join(ENCODE_ROOT, folderName);
    const tempDir = path.join(folderNameDir, safeName);

    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });

    const m3u8Path = path.join(tempDir, "index.m3u8");

    // ลงทะเบียนงานนี้ไว้ใน registry (ยังไม่มี ffmpegCommand เพราะสร้างข้างล่าง)
    const jobEntry = {
      ffmpegCommand: null,
      r2Upload: null,
      tempDir,
      mergedPath: inputPath,
      cancelled: false,
    };
    activeJobs.set(uploadId, jobEntry);

    const cleanupAndReject = (err) => {
      if (fs.existsSync(tempDir))
        fs.rmSync(tempDir, { recursive: true, force: true });
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      activeJobs.delete(uploadId);
      reject(err);
    };

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
      fs.writeFileSync(keyInfoPath, keyInfoContent, "utf8");

      const command = ffmpeg(inputPath)
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
        .output(m3u8Path);

      jobEntry.ffmpegCommand = command; // เก็บ reference ไว้ยกเลิกภายหลัง

      command
        .on("end", async () => {
          // เช็คก่อนว่างานนี้ถูกยกเลิกไปแล้วหรือยัง (ระหว่างที่ ffmpeg กำลังทำงาน)
          if (jobEntry.cancelled) {
            console.log(
              `🚫 Job ${uploadId} was cancelled before upload started`,
            );
            cleanupAndReject(new Error("Upload cancelled by user"));
            return;
          }

          const generatedFiles = fs.readdirSync(tempDir);
          const totalFiles = generatedFiles.length;
          let uploadedCount = 0;

          try {
            for (const fileName of generatedFiles) {
              if (fileName === "key_info.file") {
                uploadedCount++;
                continue;
              }

              // เช็คสถานะ cancel ก่อนอัปโหลดไฟล์แต่ละไฟล์
              if (jobEntry.cancelled) {
                throw new Error("Upload cancelled by user");
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

              jobEntry.r2Upload = parallelUploads3; // เก็บ reference ไว้ .abort() ได้

              parallelUploads3.on("httpUploadProgress", (progress) => {
                const totalPercent = Math.round(
                  ((uploadedCount + progress.loaded / progress.total) /
                    totalFiles) *
                    100,
                );
                broadcastProgress(uploadId, {
                  status: "uploading",
                  totalPercent,
                  currentFile: fileName,
                  fileIndex: uploadedCount + 1,
                  totalFiles,
                });
              });

              await parallelUploads3.done();
              uploadedCount++;
            }

            fs.rmSync(tempDir, { recursive: true, force: true });
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            activeJobs.delete(uploadId);

            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            resolve({
              video_name: originalname,
              url: `${process.env.R2_PUBLIC_URL}/videos/${folderName}/${safeName}/index.m3u8`,
              key_url: `${process.env.R2_PUBLIC_URL}/get-key?key=videos/${folderName}/${safeName}/${keyFileName}`,
              type: "hls",
              is_encrypted: true,
              duration,
            });
          } catch (uploadError) {
            console.error("❌ R2 Upload Error/Cancelled:", uploadError.message);
            cleanupAndReject(uploadError);
          }
        })
        .on("error", (err) => {
          // ffmpeg จะ trigger error event นี้เองเมื่อถูก .kill()
          console.error("❌ FFmpeg Error/Killed:", err.message);
          cleanupAndReject(err);
        })
        .run();
    } catch (error) {
      cleanupAndReject(error);
    }
  });
};

const cancelVideoUpload = async (req, res) => {
  const { uploadId } = req.body;
  if (!uploadId) return res.status(400).json({ message: "ไม่พบ uploadId" });

  try {
    // --- กรณี 1: งานอยู่ใน phase "กำลังส่ง chunk" (ยังไม่เรียก complete) ---
    const chunkDir = path.join(CHUNK_ROOT, uploadId);
    if (fs.existsSync(chunkDir)) {
      fs.rmSync(chunkDir, { recursive: true, force: true });
      console.log(`🚫 Cancelled at chunk phase: ${uploadId}`);
      return res
        .status(200)
        .json({ message: "ยกเลิกการอัปโหลดสำเร็จ (ระหว่างส่ง chunk)" });
    }

    // --- กรณี 2: งานอยู่ใน phase "กำลัง encode/upload R2" (background job) ---
    const job = activeJobs.get(uploadId);
    if (job) {
      job.cancelled = true; // ตั้ง flag ไว้ให้ loop upload เช็คแล้วหยุดเอง

      // สั่ง kill ffmpeg process ทันที (ถ้ายังรัน encode อยู่)
      if (job.ffmpegCommand) {
        try {
          job.ffmpegCommand.kill("SIGKILL");
        } catch (e) {
          /* อาจ process จบไปแล้ว */
        }
      }

      // สั่ง abort R2 multipart upload ทันที (ถ้ากำลังอัปโหลดไฟล์อยู่)
      if (job.r2Upload) {
        try {
          await job.r2Upload.abort();
        } catch (e) {
          /* ignore */
        }
      }

      console.log(`🚫 Cancelled at encode/upload phase: ${uploadId}`);
      return res
        .status(200)
        .json({ message: "ยกเลิกการอัปโหลดสำเร็จ (ระหว่างประมวลผล/อัปโหลด)" });
    }

    // --- กรณี 3: ไม่พบงานเลย (อาจเสร็จไปแล้ว หรือ uploadId ผิด) ---
    return res
      .status(404)
      .json({ message: "ไม่พบงานที่ต้องการยกเลิก อาจเสร็จสิ้นไปแล้ว" });
  } catch (err) {
    console.error("❌ Cancel Upload Error:", err);
    return res
      .status(500)
      .json({ message: "ยกเลิกไม่สำเร็จ", error: err.message });
  }
};

// ------------------ Cleanup stale chunk uploads --------------------
// ป้องกันกรณี: เน็ตหลุดระหว่างส่ง chunk / ผู้ใช้ปิด tab กลางทาง / เครื่องค้าง
// ทำให้ completeVideoUpload ไม่เคยถูกเรียก → chunkDir ค้างอยู่ใน disk ตลอดไป
const CHUNK_STALE_MS = 6 * 60 * 60 * 1000; // เกณฑ์: นิ่งเกิน 6 ชม. ถือว่าถูกทิ้งขว้าง (ปรับได้)

const cleanupStaleChunkUploads = () => {
  try {
    if (!fs.existsSync(CHUNK_ROOT)) return;

    const uploadDirs = fs.readdirSync(CHUNK_ROOT);
    const now = Date.now();
    let cleanedCount = 0;

    for (const uploadId of uploadDirs) {
      const dirPath = path.join(CHUNK_ROOT, uploadId);

      try {
        const stat = fs.statSync(dirPath);
        if (!stat.isDirectory()) continue;

        // mtime จะถูกอัปเดตทุกครั้งที่มี chunk ใหม่เขียนเข้า folder
        // ดังนั้นถ้ายัง active อยู่จริง mtime จะสดใหม่เสมอ ไม่โดนลบ
        if (now - stat.mtimeMs > CHUNK_STALE_MS) {
          fs.rmSync(dirPath, { recursive: true, force: true });
          cleanedCount++;
          console.log(
            `🧹 Cleaned stale chunk upload: ${uploadId} (age: ${Math.round((now - stat.mtimeMs) / 60000)} min)`,
          );
        }
      } catch (innerErr) {
        // เผื่อกรณี folder ถูกลบไปพร้อมกันโดย process อื่น (race condition)
        console.warn(`⚠️ Skip cleanup for ${uploadId}:`, innerErr.message);
      }
    }

    if (cleanedCount > 0) {
      console.log(
        `🧹 Chunk cleanup done: removed ${cleanedCount} stale upload(s)`,
      );
    }
  } catch (err) {
    console.error("❌ Chunk Cleanup Error:", err);
  }
};

// รันทันทีตอน server start (เผื่อมีของค้างจาก process รอบก่อนที่เพิ่ง restart)
cleanupStaleChunkUploads();

// รันซ้ำอัตโนมัติทุก 1 ชั่วโมง ตลอดอายุของ server process
setInterval(cleanupStaleChunkUploads, 60 * 60 * 1000);

module.exports = {
  uploadVideoChunk,
  completeVideoUpload,
  cancelVideoUpload,
  cleanupStaleChunkUploads,
  uploadVideo,
  uploadImage,
  createImage,
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
