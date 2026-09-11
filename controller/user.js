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
const user = require("../model/user.js");

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

    console.log("req user role : ", req.user);

    if (req.user && req.user.role === "Admin") {
      // Admin เห็นทั้งหมด ไม่กรอง status และไม่กรอง tag
      whereCondition = {};
    } else if (req.user && req.user.role === "employee") {
      // employee เห็นเฉพาะ tag = employee หรือ all
      whereCondition.tag = { [Op.in]: ["employee", "all"] };
    } else {
      // user ทั่วไป (รวมถึงยังไม่ได้ login) เห็นเฉพาะ tag = user หรือ all
      whereCondition.tag = { [Op.in]: ["user", "all"] };
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
        "tag",
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

const registerApple = async (req, res) => {
  try {
    const {
      prefix,
      first_name,
      last_name,
      email_address,
      useridentifier,
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
        useridentifier: useridentifier, // เปลี่ยนมาเช็คที่ useridentifier แทน email_address สำหรับ Apple ID
        email_address: email_address,
        login_method: "apple_id",
      },
    });

    // 2. ถ้ามีข้อมูลอยู่แล้ว ให้ส่ง Error กลับไปทันที
    if (existingUser) {
      return res.status(400).json({
        status: "error",
        message: "อีเมลนี้ถูกลงทะเบียนด้วย Apple ID ไว้แล้วในระบบ",
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
      useridentifier,
      phonenumber,
      birthday: birthday,
      role,
      login_method,
      address,
      imageURL,
    });

    return res.status(201).json({
      status: "success",
      message: "Apple ID type registered successfully",
      data: {
        id: newUser.id,
        user_id: newUser.user_id,
        useridentifier: newUser.useridentifier,
        email_address: newUser.email_address,
        role: newUser.role,
      },
    });
  } catch (error) {
    console.error("❌ Register Apple Error:", error);

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

const createUserInDB = async (userData) => {
  const {
    iduser_External, // เพิ่ม
    accessToken_External, // เพิ่ม
    refreshToken_External, // เพิ่ม
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

  try {
    // 1. เช็คว่ามี User หรือยัง
    const existingUser = await User.findOne({
      where: { email: email_address, role: "employee" },
    });

    if (existingUser) {
      try {
        await existingUser.update({
          iduser_External,
          accessToken_External,
          refreshToken_External,
        });
        console.log("✅ Existing user found, external tokens synced:", {
          iduser_External,
          accessToken_External,
          refreshToken_External,
        });
        return existingUser;
      } catch (updateError) {
        console.error("🔴 [UPDATE existingUser] error.name:", updateError.name);
        console.error(
          "🔴 [UPDATE existingUser] error.message:",
          updateError.message,
        );
        if (updateError.errors) {
          console.error(
            "🔴 [UPDATE existingUser] fields:",
            updateError.errors.map((e) => ({
              path: e.path,
              value: e.value,
              type: e.type,
              message: e.message,
            })),
          );
        }
        if (updateError.parent) {
          console.error(
            "🔴 [UPDATE existingUser] sqlMessage:",
            updateError.parent.sqlMessage,
          );
          console.error(
            "🔴 [UPDATE existingUser] sql code:",
            updateError.parent.code,
          );
        }
        throw updateError;
      }
    }

    // 2. Generate ID
    let lastUser;
    try {
      lastUser = await User.findOne({
        where: { user_id: { [Op.like]: "USR%" } },
        order: [["user_id", "DESC"]],
      });
    } catch (findLastUserError) {
      console.error("🔴 [FIND lastUser] error.name:", findLastUserError.name);
      console.error(
        "🔴 [FIND lastUser] error.message:",
        findLastUserError.message,
      );
      throw findLastUserError;
    }

    let newUserId = "USR0001";
    if (lastUser) {
      const lastIdNumber = parseInt(lastUser.user_id.replace("USR", ""));
      newUserId = `USR${(lastIdNumber + 1).toString().padStart(4, "0")}`;
    }

    // 3. สร้าง User
    try {
      const newUser = await User.create({
        user_id: newUserId,
        prefix: prefix || "Dr.",
        first_name,
        last_name,
        email: email_address,
        password: password,
        email_address: email_address,
        phonenumber: phonenumber || "-",
        birthday: birthday || "2001-01-01",
        role: "employee",
        login_method: login_method || "internal",
        address: address || {},
        iduser_External, // เพิ่ม
        accessToken_External, // เพิ่ม
        refreshToken_External, // เพิ่ม
      });

      console.log("✅ New user created:", newUser.user_id);
      return newUser;
    } catch (createError) {
      console.error("🔴 [CREATE newUser] error.name:", createError.name);
      console.error("🔴 [CREATE newUser] error.message:", createError.message);
      if (createError.errors) {
        console.error(
          "🔴 [CREATE newUser] fields:",
          createError.errors.map((e) => ({
            path: e.path,
            value: e.value,
            type: e.type,
            message: e.message,
          })),
        );
      }
      if (createError.parent) {
        console.error(
          "🔴 [CREATE newUser] sqlMessage:",
          createError.parent.sqlMessage,
        );
        console.error("🔴 [CREATE newUser] sql code:", createError.parent.code);
      }
      // ข้อมูลที่พยายามส่งเข้าไป จะได้เทียบกับ sqlMessage ได้ง่ายขึ้น
      console.error("🔴 [CREATE newUser] payload attempted:", {
        user_id: newUserId,
        email: email_address,
        email_address: email_address,
        iduser_External,
        phonenumber: phonenumber || "-",
      });
      throw createError;
    }
  } catch (error) {
    // จุดสุดท้าย เผื่อมี error หลุดรอดออกมาจากที่อื่น
    console.error("🔴 [createUserInDB] Unhandled error name:", error.name);
    console.error(
      "🔴 [createUserInDB] Unhandled error message:",
      error.message,
    );
    throw error; // โยนต่อให้ callExternalLogin จับอีกที
  }
};

const enrollments = async (req, res) => {
  const { user_id, course_id, status, payment_method, payment_proof } =
    req.body;

  console.log("📥 [enrollments] incoming payload:", {
    user_id,
    course_id,
    status,
    payment_method,
    payment_proof,
  });

  try {
    if (!user_id || !course_id) {
      console.warn("⚠️ [enrollments] missing required fields:", {
        user_id,
        course_id,
      });
      return res.status(400).json({
        status: "error",
        message: `ข้อมูลไม่ครบ: user_id=${user_id}, course_id=${course_id}`,
      });
    }

    // 1. เช็คว่าเคยลงทะเบียนไปแล้วหรือยัง
    let existingEnrollment;
    try {
      existingEnrollment = await Enrollment.findOne({
        where: { user_id, course_id },
      });
      console.log(
        "🔍 [FIND existingEnrollment] result:",
        existingEnrollment ? existingEnrollment.toJSON() : null,
      );
    } catch (findEnrollmentError) {
      console.error(
        "🔴 [FIND existingEnrollment] error.name:",
        findEnrollmentError.name,
      );
      console.error(
        "🔴 [FIND existingEnrollment] error.message:",
        findEnrollmentError.message,
      );
      throw findEnrollmentError;
    }

    if (existingEnrollment) {
      if (existingEnrollment.status === "pending" && status === "success") {
        try {
          await existingEnrollment.update({ status: "success" });
          console.log(
            "✅ [UPDATE existingEnrollment] updated to success:",
            existingEnrollment.enrollment_id || existingEnrollment.id,
          );
          return res.status(200).json({
            status: "success",
            message: "อัปเดตสถานะการชำระเงินสำเร็จ",
            data: existingEnrollment,
          });
        } catch (updateEnrollmentError) {
          console.error(
            "🔴 [UPDATE existingEnrollment] error.name:",
            updateEnrollmentError.name,
          );
          console.error(
            "🔴 [UPDATE existingEnrollment] error.message:",
            updateEnrollmentError.message,
          );
          if (updateEnrollmentError.errors) {
            console.error(
              "🔴 [UPDATE existingEnrollment] fields:",
              updateEnrollmentError.errors.map((e) => ({
                path: e.path,
                value: e.value,
                message: e.message,
              })),
            );
          }
          throw updateEnrollmentError;
        }
      }

      console.warn(
        "⚠️ [enrollments] duplicate enrollment blocked:",
        `user_id=${user_id}, course_id=${course_id}, existing_status=${existingEnrollment.status}`,
      );
      return res
        .status(400)
        .json({ status: "error", message: "คุณได้ลงทะเบียนคอร์สนี้ไปแล้ว" });
    }

    // 2. ดึงข้อมูลคอร์ส
    let course;
    try {
      course = await Course.findOne({
        where: { course_id },
        attributes: ["fee"],
      });
      console.log("🔍 [FIND course] result:", course ? course.toJSON() : null);
    } catch (findCourseError) {
      console.error("🔴 [FIND course] error.name:", findCourseError.name);
      console.error("🔴 [FIND course] error.message:", findCourseError.message);
      throw findCourseError;
    }

    if (!course) {
      console.warn("⚠️ [enrollments] course not found:", course_id);
      return res
        .status(404)
        .json({ status: "error", message: "ไม่พบข้อมูลคอร์ส" });
    }

    // ดึงข้อมูล User เพื่อเช็ค role และหา iduser_external
    let user;
    try {
      user = await User.findOne({
        where: { user_id },
        attributes: ["role", "iduser_External"],
      });
      console.log("🔍 [FIND user] result:", user ? user.toJSON() : null);
    } catch (findUserError) {
      console.error("🔴 [FIND user] error.name:", findUserError.name);
      console.error("🔴 [FIND user] error.message:", findUserError.message);
      throw findUserError;
    }

    const iduserExternal =
      user && user.role === "employee" ? user.iduser_External : null;

    const currentFee = parseFloat(course.fee);
    console.log("💰 [enrollments] currentFee:", currentFee);

    try {
      await Course.increment("count", {
        by: 1,
        where: { course_id: course_id },
      });
      console.log("✅ [Course.increment] count +1 for course_id:", course_id);
    } catch (incrementError) {
      console.error("🔴 [Course.increment] error.name:", incrementError.name);
      console.error(
        "🔴 [Course.increment] error.message:",
        incrementError.message,
      );
      throw incrementError;
    }

    // 3. สร้างรายการ Enrollment
    let newEnrollment;
    try {
      const enrollmentPayload = {
        user_id,
        course_id,
        price_at_purchase: currentFee,
        payment_method,
        payment_proof,
        iduser_External: iduserExternal,
        status:
          currentFee === 0 || status === "success" ? "success" : "pending",
      };
      console.log(
        "📝 [CREATE newEnrollment] payload attempted:",
        enrollmentPayload,
      );

      newEnrollment = await Enrollment.create(enrollmentPayload);
      console.log("✅ [CREATE newEnrollment] created:", newEnrollment.toJSON());
    } catch (createEnrollmentError) {
      console.error(
        "🔴 [CREATE newEnrollment] error.name:",
        createEnrollmentError.name,
      );
      console.error(
        "🔴 [CREATE newEnrollment] error.message:",
        createEnrollmentError.message,
      );
      if (createEnrollmentError.errors) {
        console.error(
          "🔴 [CREATE newEnrollment] fields:",
          createEnrollmentError.errors.map((e) => ({
            path: e.path,
            value: e.value,
            type: e.type,
            message: e.message,
          })),
        );
      }
      if (createEnrollmentError.parent) {
        console.error(
          "🔴 [CREATE newEnrollment] sqlMessage:",
          createEnrollmentError.parent.sqlMessage,
        );
        console.error(
          "🔴 [CREATE newEnrollment] sql code:",
          createEnrollmentError.parent.code,
        );
      }
      throw createEnrollmentError;
    }

    return res.status(201).json({
      status: "success",
      message:
        newEnrollment.status === "success"
          ? "ยินดีด้วย! คุณเข้าเรียนได้ทันที"
          : "สร้างรายการสั่งซื้อสำเร็จ",
      data: newEnrollment,
    });
  } catch (error) {
    console.error("🔴 [enrollments] Unhandled error name:", error.name);
    console.error("🔴 [enrollments] Unhandled error message:", error.message);
    return res.status(500).json({ status: "error", message: error.message });
  }
};

const InAppPurchase = async (req, res) => {
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
      status: "success",
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
    let progress = await User_Progress.findOne({
      where: {
        user_id,
        course_id,
        station_id,
        video_name,
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
      // ดึงข้อมูล User เพื่อเช็ค role และหา iduser_external
      const user = await User.findOne({
        where: { user_id },
        attributes: ["role", "iduser_External"],
      });

      const iduserExternal =
        user && user.role === "employee" ? user.iduser_External : null;

      progress = await User_Progress.create({
        user_id,
        course_id,
        station_id,
        video_name,
        iduser_External: iduserExternal,
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

const updateLearningStatus = async (req, res) => {
  try {
    const { user_id, course_id } = req.body;

    // 1. Basic validation
    if (!user_id || !course_id) {
      return res.status(400).json({
        status: "error",
        message: "user_id and course_id are required",
      });
    }

    const enrollment = await Enrollment.findOne({
      where: { user_id, course_id },
    });

    if (!enrollment) {
      return res.status(404).json({
        status: "error",
        message: "ไม่พบข้อมูลการลงทะเบียนสำหรับผู้ใช้และคอร์สนี้",
      });
    }

    // --- ส่วนที่เพิ่มการเช็คสถานะ ---
    if (enrollment.learning_status === "complete") {
      return res.status(200).json({
        status: "success",
        message: "คอร์สนี้ถูกเรียนจบ (complete) ไปก่อนหน้านี้เรียบร้อยแล้ว",
        data: {
          learning_status: enrollment.learning_status,
        },
      });
    }
    // ----------------------------

    // 2. Update and save (กรณีที่ยังไม่เป็น complete)
    enrollment.learning_status = "complete";
    await enrollment.save();

    // 3. Send a success response
    return res.status(200).json({
      status: "success",
      message: "ปรับปรุงสถานะการเรียนเป็นเรียนจบเรียบร้อยแล้ว",
      data: {
        learning_status: enrollment.learning_status,
      },
    });
  } catch (error) {
    console.error("Error updating learning status:", error);
    res.status(500).json({
      status: "error",
      message: "Internal Server Error",
    });
  }
};

const forgotPassword = async (req, res) => {
  const { email_address, newPassword } = req.body;
  try {
    // 1. เปลี่ยนชื่อตัวแปรจาก User เป็น existingUser เพื่อไม่ให้ซ้ำกับ Model
    const existingUser = await User.findOne({
      where: { email_address: email_address },
    });

    if (!existingUser) {
      return res.status(404).json({
        status: "error",
        message: `ไม่พบผู้ใช้งานที่มีอีเมลนี้ในระบบ ${email_address}`,
      });
    }

    // 2. กำหนดค่ารหัสผ่านใหม่ลงไปตรงๆ (ไม่ต้องสั่ง bcrypt.hash เองในนี้)
    existingUser.password = newPassword;

    // 3. ใช้ .save() เพื่อสั่งบันทึกข้อมูลลง Database
    // ตัว Sequelize จะรู้ว่า password เปลี่ยนไป และจะไปเรียกก่อนเซฟ (beforeUpdate Hook)
    // เพื่อแอบใส่ bcrypt.hash(newPassword, 10) ให้คุณโดยอัตโนมัติ!
    await existingUser.save();

    // 4. ส่ง response กลับหา Frontend เสมอเพื่อไม่ให้ Request ค้าง
    return res.status(200).json({
      status: "success",
      message: "เปลี่ยนรหัสผ่านใหม่สำเร็จแล้ว",
    });
  } catch (error) {
    console.error("Forget Password Error:", error);
    res.status(500).json({
      status: "error",
      message: "Internal Server Error",
    });
  }
};

const ChangePassword = async (req, res) => {
  const { oldPassword, email_address, newPassword } = req.body;

  try {
    // 1. ค้นหาผู้ใช้งานจาก Email
    const existingUser = await User.findOne({
      where: { email_address: email_address },
    });

    if (!existingUser) {
      return res.status(404).json({
        status: "error",
        message: `ไม่พบผู้ใช้งานที่มีอีเมลนี้ในระบบ ${email_address}`,
      });
    }

    // 2. ใช้ Instance Method จาก Model ในการเช็กรหัสผ่านเดิม
    const isMatch = await existingUser.comparePassword(oldPassword);

    if (!isMatch) {
      return res.status(400).json({
        status: "error",
        message: "รหัสผ่านเดิมไม่ถูกต้อง",
      });
    }

    // 3. กำหนดค่ารหัสผ่านใหม่ลงไปตรงๆ
    existingUser.password = newPassword;

    // 4. บันทึกข้อมูลลง Database
    // ตัว `beforeUpdate` hook ใน Model จะทำงานอัตโนมัติเพราะเช็ก user.changed("password") ไว้แล้ว
    await existingUser.save();

    // 5. ส่ง response กลับหา Frontend
    return res.status(200).json({
      status: "success",
      message: "เปลี่ยนรหัสผ่านใหม่สำเร็จแล้ว",
    });
  } catch (error) {
    console.error("Change Password Error:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal Server Error",
    });
  }
};

const getProgressCourseByiduserExternal = async (req, res) => {
  const { iduser_External } = req.body;

  console.log("📥 [getProgressCourseByiduserExternal] incoming:", {
    iduser_External,
  });

  try {
    if (!iduser_External) {
      return res.status(400).json({
        status: "error",
        message: "กรุณาระบุ iduser_External",
      });
    }

    // 1. ดึงข้อมูล User_Progress ทั้งหมดของ iduser_External นี้
    let progressList;
    try {
      progressList = await User_Progress.findAll({
        where: { iduser_External },
        attributes: { exclude: ["createdAt", "updatedAt"] },
        order: [["updatedAt", "DESC"]],
      });
      console.log("🔍 [FIND User_Progress] count:", progressList.length);
    } catch (findProgressError) {
      console.error(
        "🔴 [FIND User_Progress] error.name:",
        findProgressError.name,
      );
      console.error(
        "🔴 [FIND User_Progress] error.message:",
        findProgressError.message,
      );
      throw findProgressError;
    }

    if (progressList.length === 0) {
      return res.status(200).json({
        status: "success",
        message: "ไม่พบข้อมูล progress",
        data: [],
      });
    }

    // 2. ดึง course_id ที่ไม่ซ้ำกันออกมา แล้วดึงข้อมูล Course ทั้งหมดในครั้งเดียว
    const courseIds = [
      ...new Set(progressList.map((p) => p.course_id).filter(Boolean)),
    ];
    console.log("🔍 [unique course_ids]:", courseIds);

    let courses;
    try {
      courses = await Course.findAll({
        where: { course_id: courseIds },
        attributes: { exclude: ["status", "tag", "createdAt", "updatedAt"] },
      });
      console.log("🔍 [FIND Course] count:", courses.length);
    } catch (findCourseError) {
      console.error("🔴 [FIND Course] error.name:", findCourseError.name);
      console.error("🔴 [FIND Course] error.message:", findCourseError.message);
      throw findCourseError;
    }

    // 3. จัดกลุ่มใหม่: เอา course ขึ้นเป็นระดับบนสุด แล้วรวม progress ทั้งหมดของ course นั้นไว้ด้วยกัน
    const courseGroupMap = {}; // course_id -> { ...courseData, progress: [...] }

    courses.forEach((c) => {
      courseGroupMap[c.course_id] = {
        ...c.toJSON(),
        progress: [],
      };
    });

    progressList.forEach((p) => {
      const plain = p.toJSON();
      const { course_id, ...progressOnly } = plain; // ตัด course_id ออกจาก progress object เพราะซ้ำกับ key ข้างนอกแล้ว

      if (courseGroupMap[course_id]) {
        courseGroupMap[course_id].progress.push(progressOnly);
      }
    });

    const result = Object.values(courseGroupMap);

    return res.status(200).json({
      status: "success",
      message: "ดึงข้อมูล progress สำเร็จ",
      data: result,
    });
  } catch (error) {
    console.error(
      "🔴 [getProgressCourseByiduserExternal] Unhandled error name:",
      error.name,
    );
    console.error(
      "🔴 [getProgressCourseByiduserExternal] Unhandled error message:",
      error.message,
    );
    return res.status(500).json({ status: "error", message: error.message });
  }
};

module.exports = {
  getCourse,
  register,
  registerGoogle,
  registerApple,
  createUserInDB,
  enrollments,
  syncUser,
  updateStudentProgress,
  getCategories,
  forgotPassword,
  getProgress,
  getProgressCourse,
  edit_profile,
  uploadImage,
  getLastWatching,
  ChangePassword,
  updateLearningStatus,
  getProgressCourseByiduserExternal,
};
