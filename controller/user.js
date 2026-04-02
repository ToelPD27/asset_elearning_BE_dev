const {
  User,
  Category,
  Course,
  Station,
  Enrollment,
  User_Progress,
} = require("../model/index.js");
const { Op } = require("sequelize");
const r2 = require("../libs/r2Client.js");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const path = require("path");

const uploadImage = async (req, res) => {
  try {
    const file = req.file;

    // 1. ตรวจสอบว่ามีไฟล์ส่งมาไหม
    if (!file) {
      return res.status(400).json({ message: "กรุณาเลือกรูปภาพสลิป" });
    }

    // 2. ตรวจสอบนามสกุลไฟล์ (ป้องกันคนอัปโหลดไฟล์อื่นที่ไม่ใช่รูป)
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.mimetype)) {
      return res
        .status(400)
        .json({ message: "รองรับเฉพาะไฟล์รูปภาพ (JPG, PNG, WEBP) เท่านั้น" });
    }

    // 3. สร้างชื่อไฟล์ใหม่เพื่อป้องกันการซ้ำ (เช่น slip-1739082000-image.jpg)
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const fileName = `Slip/${uniqueSuffix}-${file.originalname}`;

    // 4. เตรียมพารามิเตอร์สำหรับ Cloudflare R2
    const uploadParams = {
      Bucket: process.env.R2_BUCKET_NAME,
      Key: fileName, // เก็บใน Folder slip/ ใน Bucket
      Body: file.buffer,
      ContentType: file.mimetype,
    };

    // 5. ส่งไฟล์ไปที่ R2
    await r2.send(new PutObjectCommand(uploadParams));

    // 6. ส่ง URL กลับไปให้ Frontend
    // Frontend จะเอา URL นี้ไปใส่ในช่อง payment_proof ตอนเรียก API enrollments
    const publicUrl = `${process.env.R2_PUBLIC_URL}/${fileName}`;

    return res.status(200).json({
      message: "อัปโหลดสลิปสำเร็จ",
      status: "success",
      url: publicUrl,
      fileName: fileName, // ควรเก็บชื่อนี้ไว้ใน Database (payment_proof)
    });
  } catch (error) {
    console.error("Upload Image Error:", error);
    return res.status(500).json({
      message: "เกิดข้อผิดพลาดในการอัปโหลดรูปภาพ",
      error: error.message,
    });
  }
};

const getCourse = async (req, res) => {
  try {
    // กำหนดเงื่อนไขเริ่มต้น
    let whereCondition = { status: "active" };

    // ถ้ามีการ Login และ Role เป็น Admin ให้ลบเงื่อนไข status ออก (ดึงทั้งหมด)
    console.log("req user role : ", req.user);
    if (req.user && req.user.role === "Admin") {
      whereCondition = {};
    }

    const courses = await Course.findAll({
      where: whereCondition,
      attributes: [
        "course_id",
        "course_name",
        "count",
        "fee",
        "detail",
        "image",
        "status", // แนะนำให้ดึงไปแสดงในหน้า Admin
        "createdAt",
      ],
      include: [
        {
          model: Category,
          as: "category",
          attributes: ["category_id", "category_name"],
        },
        {
          model: Station,
          as: "stations",
          attributes: ["station_id", "station_name", "videos"],
          separate: true,
          order: [["station_id", "ASC"]],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    if (!courses || courses.length === 0) {
      return res.status(404).json({
        status: "fail",
        message: "No courses found",
      });
    }

    // จัดระเบียบ Response
    const data = courses.map((course) => course.toJSON());

    res.status(200).json({
      status: "success",
      isAdmin: req.user?.role === "Admin", // บอก frontend ด้วยว่าเป็น admin ไหม
      results: data.length,
      data: data,
    });
  } catch (err) {
    console.error("❌ Get Course Error:", err);
    res.status(500).json({
      status: "error",
      message: "Internal Server Error",
    });
  }
};

const register = async (req, res) => {
  try {
    const {
      prefix,
      first_name,
      last_name,
      email,
      email_address,
      password,
      phonenumber,
      birthday,
      role,
      login_method,
      address,
    } = req.body;

    // 1. ตรวจสอบว่ามี Email นี้ที่สมัครแบบ internal อยู่แล้วหรือไม่
    const existingUser = await User.findOne({
      where: {
        email: email,
        login_method: "internal",
      },
    });

    // 💡 เพิ่มส่วนนี้: ถ้าเจอ user ซ้ำให้ return ออกไปทันที
    if (existingUser) {
      return res.status(400).json({
        status: "error",
        message: "อีเมลนี้ถูกใช้งานแล้วในระบบ (Internal)",
      });
    }

    // 2. ค้นหา ID ล่าสุดเพื่อสร้าง ID ใหม่
    const lastUser = await User.findOne({
      where: { user_id: { [Op.like]: "USR%" } },
      order: [["user_id", "DESC"]],
    });

    let newUserId = "USR0001";
    if (lastUser) {
      const lastIdNumber = parseInt(lastUser.user_id.replace("USR", ""));
      const nextIdNumber = lastIdNumber + 1;
      newUserId = `USR${nextIdNumber.toString().padStart(4, "0")}`;
    }

    // 3. สร้าง User ใหม่
    // หมายเหตุ: ควรทำการ Hash Password ก่อนบันทึกเพื่อความปลอดภัย
    const newUser = await User.create({
      user_id: newUserId,
      prefix,
      first_name,
      last_name,
      email,
      email_address,
      password,
      phonenumber,
      birthday,
      role,
      login_method,
      address,
    });

    return res.status(201).json({
      status: "success",
      message: "User registered successfully",
      data: {
        id: newUser.id,
        user_id: newUser.user_id,
        email: newUser.email,
        role: newUser.role,
      },
    });
  } catch (error) {
    console.error("❌ Register Error:", error);
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(400).json({
        status: "error",
        message: "Email already exists in system.",
      });
    }

    return res.status(500).json({
      status: "error",
      message: error.message || "Internal Server Error",
    });
  }
};

const registerGoogle = async (req, res) => {
  try {
    const {
      prefix,
      first_name,
      last_name,
      email_address,
      phonenumber,
      role,
      imageURL,
      birthday,
      login_method,
      address,
    } = req.body;

    // 1. ตรวจสอบว่ามี Email และ Login Method นี้อยู่แล้วหรือไม่
    // ใช้ findOne จะมีประสิทธิภาพมากกว่า findAll ในกรณีที่ต้องการเช็กแค่ว่า "มีหรือไม่มี"
    const existingUser = await User.findOne({
      where: {
        email_address: email_address,
        login_method: "google_email",
      },
    });

    // 2. ถ้ามีข้อมูลอยู่แล้ว ให้ส่ง Error กลับไปทันที
    if (existingUser) {
      return res.status(400).json({
        status: "error",
        message: "อีเมลนี้ถูกลงทะเบียนด้วย Google ไว้แล้วในระบบ",
      });
    }

    // --- ขั้นตอนการสร้าง User ID ใหม่ (เหมือนเดิม) ---
    const lastUser = await User.findOne({
      where: { user_id: { [Op.like]: "USR%" } },
      order: [["user_id", "DESC"]],
    });

    let newUserId = "USR0001";
    if (lastUser) {
      const lastIdNumber = parseInt(lastUser.user_id.replace("USR", ""));
      const nextIdNumber = lastIdNumber + 1;
      newUserId = `USR${nextIdNumber.toString().padStart(4, "0")}`;
    }

    // --- ขั้นตอนการบันทึกข้อมูล ---
    const newUser = await User.create({
      user_id: newUserId,
      prefix,
      first_name,
      last_name,
      email: email_address,
      email_address: email_address,
      phonenumber,
      birthday: birthday,
      role,
      login_method,
      address,
      imageURL,
    });

    return res.status(201).json({
      status: "success",
      message: "google type registered successfully",
      data: {
        id: newUser.id,
        user_id: newUser.user_id,
        email_address: newUser.email_address,
        role: newUser.role,
      },
    });
  } catch (error) {
    console.error("❌ Register Google Error:", error);

    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(400).json({
        status: "error",
        message: "Email already exists (Unique Constraint).",
      });
    }

    return res.status(500).json({
      status: "error",
      message: error.message || "Internal Server Error",
    });
  }
};

// ฟังก์ชันสำหรับสร้าง User ลง DB (เรียกใช้ซ้ำได้)
const createUserInDB = async (userData) => {
  const {
    email_address,
    password,
    first_name,
    last_name,
    prefix,
    phonenumber,
    birthday,
    login_method,
    address,
  } = userData;

  // 1. เช็คว่ามี User หรือยัง
  const existingUser = await User.findOne({
    where: { email: email_address, role: "employee" },
  });
  if (existingUser) return existingUser;

  // 2. Generate ID
  const lastUser = await User.findOne({
    where: { user_id: { [Op.like]: "USR%" } },
    order: [["user_id", "DESC"]],
  });
  let newUserId = "USR0001";
  if (lastUser) {
    const lastIdNumber = parseInt(lastUser.user_id.replace("USR", ""));
    newUserId = `USR${(lastIdNumber + 1).toString().padStart(4, "0")}`;
  }

  // 3. สร้าง User (ลบ .than ที่สะกดผิดออก)
  const newUser = await User.create({
    user_id: newUserId,
    prefix: prefix || "Dr.",
    first_name,
    last_name,
    email: email_address,
    password: password, // ส่งตรงๆ ตามที่คุณต้องการเหมือนฟังก์ชันอื่น
    email_address: email_address,
    phonenumber: phonenumber || "-",
    birthday: birthday || "2001-01-01",
    role: "employee",
    login_method: login_method || "internal",
    address: address || {},
  });

  // console.log("✅ register success for:", newUser);
  return newUser;
};

const enrollments = async (req, res) => {
  const { user_id, course_id, status, payment_method, payment_proof } =
    req.body;

  try {
    // 1. ตรวจสอบว่าเคยลงทะเบียนไปแล้วหรือยังฅ

    // เพิ่ม Validation เพื่อเช็คว่ามีค่าส่งมาจริงไหม
    if (!user_id || !course_id) {
      return res.status(400).json({
        status: "error",
        message: `ข้อมูลไม่ครบ: user_id=${user_id}, course_id=${course_id}`,
      });
    }

    const existingEnrollment = await Enrollment.findOne({
      where: { user_id, course_id },
    });

    if (existingEnrollment) {
      // ถ้าเคยมีรายการแล้วแต่สถานะยังเป็น pending เราอาจจะอัปเดตสถานะแทนการสร้างใหม่
      if (existingEnrollment.status === "pending" && status === "success") {
        await existingEnrollment.update({ status: "success" });
        return res.status(200).json({
          status: "success",
          message: "อัปเดตสถานะการชำระเงินสำเร็จ",
          data: existingEnrollment,
        });
      }
      return res
        .status(400)
        .json({ status: "error", message: "คุณได้ลงทะเบียนคอร์สนี้ไปแล้ว" });
    }

    // 2. ดึงข้อมูลคอร์ส
    const course = await Course.findOne({
      where: { course_id },
      attributes: ["fee"],
    });

    if (!course) {
      return res
        .status(404)
        .json({ status: "error", message: "ไม่พบข้อมูลคอร์ส" });
    }

    const currentFee = parseFloat(course.fee);
    await Course.increment("count", {
      by: 1,
      where: { course_id: course_id },
    });

    // 3. สร้างรายการ Enrollment
    const newEnrollment = await Enrollment.create({
      user_id,
      course_id,
      price_at_purchase: currentFee,
      payment_method,
      payment_proof,
      status: currentFee === 0 || status === "success" ? "success" : "pending",
    });

    return res.status(201).json({
      status: "success",
      message:
        newEnrollment.status === "success"
          ? "ยินดีด้วย! คุณเข้าเรียนได้ทันที"
          : "สร้างรายการสั่งซื้อสำเร็จ",
      data: newEnrollment,
    });
  } catch (error) {
    return res.status(500).json({ status: "error", message: error.message });
  }
};

const syncUser = async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) {
    return res
      .status(400)
      .json({ status: "error", message: "Missing user_id" });
  }

  try {
    const user = await User.findOne({
      where: { user_id },
      attributes: [
        "prefix",
        "user_id",
        "first_name",
        "last_name",
        "email",
        "role",
        "imageURL",
        "phonenumber",
        "birthday",
        "address",
        "email_address",
      ],
      include: [
        {
          model: Enrollment,
          as: "enrollments",
          // ไม่ต้องใส่ where: { user_id } ซ้ำซ้อน
          // แต่ควรใส่ status ที่ต้องการแสดงในฝั่ง User/Frontend
          where: {
            status: ["success", "pending"], // ดึงทั้งที่สำเร็จและรอตรวจ เพื่อให้ User เห็นสถานะตัวเอง
          },
          attributes: [
            "course_id",
            "status",
            "payment_method",
            "createdAt",
            "complete_status",
            "price_at_purchase",
          ],
          required: false, // สำคัญ: เพื่อให้ยังได้ข้อมูล User แม้จะยังไม่เคยซื้อคอร์ส
        },
      ],
    });

    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "ไม่พบข้อมูลผู้ใช้งาน",
      });
    }

    // สรุปข้อมูลเบื้องต้น (Optional)
    const enrollmentCount = user.enrollments ? user.enrollments.length : 0;

    return res.json({
      status: "success",
      user: user,
      meta: {
        total_courses: enrollmentCount,
      },
    });
  } catch (error) {
    console.error("Sync User Error:", error);
    return res.status(500).json({
      status: "error",
      message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

const getCategories = async (req, res) => {
  try {
    const categories = await Category.findAll({
      attributes: ["id", "category_id", "category_name"],
      order: [["category_id", "ASC"]],
    });

    if (!categories || categories.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No categories found",
      });
    }

    return res.status(200).json({
      success: true,
      data: categories,
    });
  } catch (error) {
    console.error("Error fetching categories:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const updateStudentProgress = async (req, res) => {
  const {
    user_id,
    course_id,
    station_id,
    video_name,
    last_second,
    percent,
    max_duration,
  } = req.body;

  try {
    // ใช้ station_id และ video_name ร่วมกันในการค้นหา
    let progress = await User_Progress.findOne({
      where: {
        user_id,
        course_id,
        station_id,
        video_name, // เปลี่ยนมาใช้ชื่อวิดีโอแทน index
      },
    });

    if (progress) {
      const newPercent =
        percent > progress.progress_percent
          ? percent
          : progress.progress_percent;
      const newMaxWatching =
        last_second > progress.max_watched_second
          ? last_second
          : progress.max_watched_second;
      await progress.update({
        last_watched_second: last_second,
        max_watched_second: newMaxWatching,
        progress_percent: newPercent,
        max_duration: max_duration,
        is_completed: newPercent >= 95 || progress.is_completed,
      });
    } else {
      progress = await User_Progress.create({
        user_id,
        course_id,
        station_id,
        video_name, // บันทึกชื่อวิดีโอ
        last_watched_second: last_second,
        max_watched_second: last_second,
        progress_percent: percent,
        max_duration: max_duration,
        is_completed: percent >= 95,
      });
    }

    res.status(200).json({ message: "Progress synchronized", data: progress });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getProgress = async (req, res) => {
  try {
    const { user_id, course_id, station_id, video_name } = req.body;

    // 1. ตรวจสอบว่าส่ง Parameters สำคัญมาครบไหม
    console.log("Received params:", {
      user_id,
      course_id,
      station_id,
      video_name,
    });

    if (!user_id || !course_id || !station_id || !video_name) {
      return res.status(400).json({
        error:
          "Missing required parameters: user_id, course_id, station_id, and video_name are required.",
      });
    }

    // 2. ค้นหาข้อมูล (ใช้ findOne เพราะ 1 วิดีโอควรมี 1 record ต่อ 1 คน)
    const progress = await User_Progress.findOne({
      attributes: [
        "last_watched_second",
        "max_watched_second",
        "progress_percent",
        "is_completed",
        "updatedAt",
        "max_duration",
      ],
      where: {
        user_id,
        course_id,
        station_id,
        video_name,
      },
    });

    // 3. ตรวจสอบว่ามีข้อมูลใน Database ไหม
    if (!progress) {
      return res.status(200).json({
        message: "No progress found for this video",
        data: {
          last_watched_second: 0,
          progress_percent: 0,
          is_completed: false,
        },
      });
    }

    res.status(200).json({ data: progress });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getLastWatching = async (req, res) => {
  try {
    const { user_id, course_id } = req.body;

    if (!user_id || !course_id) {
      return res.status(400).json({
        error: "Missing user_id or course_id",
      });
    }

    const lastWatching = await User_Progress.findAll({
      where: {
        user_id,
        course_id,
      },

      order: [["updatedAt", "DESC"]],
    });

    if (!lastWatching) {
      return res.status(200).json({
        message: "No history found for this course",
        data: null,
      });
    }

    // หากต้องการให้ข้อมูล "แบน" (Flat) เพื่อให้ Flutter ใช้ง่าย
    // คุณสามารถจัดโครงสร้างใหม่ตรงนี้ได้
    res.status(200).json({
      message: "Last watched video retrieved successfully",
      data: lastWatching,
    });
  } catch (error) {
    console.error("Error fetching last watching:", error);
    res.status(500).json({ error: error.message });
  }
};

const getProgressCourse = async (req, res) => {
  try {
    const { user_id, course_id } = req.body;

    // 1. ตรวจสอบข้อมูลเบื้องต้น
    if (!user_id || !course_id) {
      return res.status(400).json({
        error: "Missing user_id or course_id",
      });
    }

    // 2. ดึง Progress ทั้งหมดของคอร์สนี้
    const progress = await User_Progress.findAll({
      attributes: [
        "station_id",
        "video_name",
        "is_completed",
        "progress_percent",
      ],
      where: {
        user_id,
        course_id,
      },
    });

    // 3. ส่งข้อมูลกลับ (ถ้าไม่เจอเลยส่งเป็น Array ว่าง)
    res.status(200).json({
      success: true,
      data: progress || [],
    });
  } catch (error) {
    console.error("Error in getProgressCourse:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

const edit_profile = async (req, res) => {
  try {
    const { user_id } = req.params;
    const {
      prefix,
      first_name,
      last_name,
      phonenumber,
      birthday,
      imageURL,
      address,
    } = req.body;

    // ✅ เอาไว้เช็คข้อมูลที่รับมาจาก Frontend
    console.log("--- Incoming Edit Data ---");
    console.log("User ID from Params:", user_id);
    console.log("Payload:", {
      prefix,
      first_name,
      last_name,
      phonenumber,
      birthday,
      imageURL,
      address,
    });

    const existingUser = await User.findOne({
      where: { user_id: user_id },
    });

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบข้อมูลผู้ใช้งานรายนี้ในระบบ",
      });
    }

    // 2. จัดการรูปแบบวันที่
    let formattedBirthday = null;
    if (birthday) {
      formattedBirthday = new Date(birthday).toISOString().split("T")[0];
    }

    // 3. แก้ไขจุดนี้: Sequelize.update(data, { where: { ... } })
    await User.update(
      {
        prefix,
        first_name,
        last_name,
        phonenumber,
        birthday: formattedBirthday,
        imageURL,
        address: address,
      },
      {
        where: { user_id: user_id }, // ย้าย where มาไว้ในพารามิเตอร์ตัวที่ 2
      },
    );

    // ดึงข้อมูลที่อัปเดตแล้วมาส่งกลับ (Sequelize update คืนค่าเป็นจำนวนแถวที่อัปเดต ไม่ใช่ตัว object)
    const updatedUser = await User.findOne({ where: { user_id } });

    return res.status(200).json({
      success: true,
      message: "อัปเดตโปรไฟล์เรียบร้อยแล้ว",
      data: updatedUser,
    });
  } catch (e) {
    console.error("Edit Profile Error:", e);
    return res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์",
      error: e.message,
    });
  }
};

module.exports = {
  getCourse,
  register,
  registerGoogle,
  createUserInDB,
  enrollments,
  syncUser,
  updateStudentProgress,
  getCategories,
  getProgress,
  getProgressCourse,
  edit_profile,
  uploadImage,
  getLastWatching,
};
