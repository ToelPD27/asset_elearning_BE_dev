const jwt = require("jsonwebtoken");
const { User, Enrollment } = require("../model/index.js");
const axios = require("axios");
const { createUserInDB } = require("./user.js");
// Helper สำหรับสร้าง Tokens

const signAccessToken = (payload) =>
  jwt.sign(payload, process.env.JWT_ACCESS_SECRET, { expiresIn: "1h" });

const signRefreshToken = (payload) =>
  jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: "7d" });

// const signAccessToken = (payload) =>
//   jwt.sign(payload, process.env.JWT_ACCESS_SECRET, { expiresIn: "30s" });

// const signRefreshToken = (payload) =>
//   jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: "2m" });

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({
      where: { email, role: ["user", "Admin"] },
    });

    if (user && (await user.comparePassword(password))) {
      // --- เพิ่มการเช็ค deactive_user ตรงนี้ ---
      if (user.deactive_user === 1) {
        return res.status(409).json({
          message: "บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ",
        });
      }
      // ------------------------------------

      const userEnrollments = await Enrollment.findAll({
        where: {
          user_id: user.user_id,
          status: ["success", "pending"],
        },
        attributes: [
          "course_id",
          "status",
          "payment_method",
          "createdAt",
          "complete_status",
          "price_at_purchase",
        ],
      });

      const payload = { id: user.id, role: user.role };
      const accessToken = signAccessToken(payload);
      const refreshToken = signRefreshToken(payload);

      return res.json({
        message: "Login Success",
        accessToken,
        refreshToken,
        user: {
          user_id: user.user_id,
          first_name: user.first_name,
          last_name: user.last_name,
          email: user.email,
          role: user.role,
          enrollments: userEnrollments,
          imageURL: user.imageURL,
          birthday: user.birthday,
          email_address: user.email_address,
          phonenumber: user.phonenumber,
          address: user.address,
        },
      });
    }

    res.status(401).json({ message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ message: "Login Error", error: err.message });
  }
};

const loginGoogle = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "ระบุอีเมลที่ต้องการเข้าใช้งาน" });
    }

    const user = await User.findOne({
      where: {
        email: email,
        login_method: "google_email",
      },
    });

    if (!user) {
      return res.status(404).json({
        message:
          "ไม่พบบัญชีผู้ใช้งานนี้ในระบบ กรุณาติดต่อผู้ดูแลเพื่อเพิ่มสิทธิ์การเข้าใช้งาน",
      });
    }

    // --- เพิ่มการเช็ค deactive_user ตรงนี้ ---
    if (user.deactive_user === 1) {
      return res.status(409).json({
        message: "บัญชี Google นี้ถูกระงับการใช้งานในระบบชั่วคราว",
      });
    }
    // ------------------------------------

    const userEnrollments = await Enrollment.findAll({
      where: {
        user_id: user.user_id,
        status: ["success", "pending"],
      },
      attributes: [
        "course_id",
        "status",
        "payment_method",
        "createdAt",
        "complete_status",
        "price_at_purchase",
      ],
    });

    const payload = { id: user.id, role: user.role };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    return res.json({
      message: "เข้าสู่ระบบสำเร็จ",
      accessToken,
      refreshToken,
      user: {
        user_id: user.user_id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email_address,
        role: user.role,
        enrollments: userEnrollments,
        imageURL: user.imageURL,
        birthday: user.birthday,
        email_address: user.email_address,
        phonenumber: user.phonenumber,
        address: user.address,
      },
    });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ message: "Login Error", error: err.message });
  }
};

const loginApple = async (req, res) => {
  try {
    const { useridentifier } = req.body;

    if (!useridentifier) {
      return res
        .status(400)
        .json({ message: "ระบุ identifier ที่ต้องการเข้าใช้งาน" });
    }

    // 1. ค้นหา User
    const user = await User.findOne({
      where: {
        useridentifier: useridentifier,
        login_method: "apple_id",
      },
    });

    // 2. ถ้าไม่พบ User
    if (!user) {
      return res.status(404).json({
        message:
          "ไม่พบบัญชีผู้ใช้งานนี้ในระบบ กรุณาติดต่อผู้ดูแลเพื่อเพิ่มสิทธิ์การเข้าใช้งาน",
      });
    }

    // 3. เช็คสถานะการระงับใช้งาน (Deactivated)
    // ใช้ 403 Forbidden เพราะเป็นการปฏิเสธสิทธิ์การเข้าถึง
    if (Number(user.deactive_user) === 1) {
      return res.status(403).json({
        message:
          "บัญชี Apple นี้ถูกระงับการใช้งานชั่วคราว กรุณาติดต่อฝ่ายสนับสนุน",
      });
    }

    // 4. ดึงข้อมูลการลงทะเบียน (Enrollments)
    const userEnrollments = await Enrollment.findAll({
      where: {
        user_id: user.user_id,
        status: ["success", "pending"],
      },
      attributes: [
        "course_id",
        "status",
        "payment_method",
        "createdAt",
        "complete_status",
        "price_at_purchase",
      ],
    });

    // 5. สร้าง Tokens
    const payload = { id: user.user_id, role: user.role }; // แนะนำให้ใช้ user_id ให้ตรงกัน
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    // 6. ส่งข้อมูลกลับ
    return res.status(200).json({
      message: "เข้าสู่ระบบสำเร็จ",
      accessToken,
      refreshToken,
      user: {
        user_id: user.user_id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email_address,
        useridentifier: user.useridentifier,
        role: user.role,
        enrollments: userEnrollments,
        imageURL: user.imageURL,
        birthday: user.birthday,
        phonenumber: user.phonenumber,
        address: user.address,
      },
    });
  } catch (err) {
    console.error("Apple Login Error:", err);
    res
      .status(500)
      .json({ message: "เกิดข้อผิดพลาดภายในระบบ", error: err.message });
  }
};

const refreshToken = async (req, res) => {
  try {
    const token = req.body.refreshToken;
    if (!token) return res.status(401).json({ message: "ไม่มี Token" });

    jwt.verify(token, process.env.JWT_REFRESH_SECRET, async (err, decoded) => {
      if (err) {
        return res.status(403).json({ message: "Token หมดอายุหรือถูกยกเลิก" });
      }

      const user = await User.findByPk(decoded.id);
      if (!user) return res.status(404).json({ message: "ไม่พบผู้ใช้งาน" });

      // 1. เจน Access Token ใหม่
      const newAccessToken = signAccessToken({ id: user.id, role: user.role });

      // 2. เจน Refresh Token ใหม่ (เพื่อให้ User ต่ออายุการใช้งานไปได้เรื่อยๆ)
      const newRefreshToken = signRefreshToken({
        id: user.id,
        role: user.role,
      });

      const userEnrollments = await Enrollment.findAll({
        where: { user_id: user.user_id, status: ["success", "pending"] },
        attributes: ["course_id", "status"],
      });

      res.json({
        message: "Token Refreshed Success",
        accessToken: newAccessToken,
        refreshToken: newRefreshToken, // ส่งอันใหม่กลับไปด้วย
        user: {
          user_id: user.user_id,
          first_name: user.first_name,
          role: user.role,
          enrollments: userEnrollments,
        },
      });
    });
  } catch (err) {
    res.status(500).json({ message: "Refresh error" });
  }
};

const callExternalLogin = async (email, password) => {
  try {
    const payload = {
      user_email: email,
      user_password: password,
    };

    const resExternal = await axios.post(
      "https://api.uniquecarestationthailand.com/api/prizemed/user/login",
      payload,
      {
        headers: { "Content-Type": "application/json" },
      },
    );

    if (resExternal.data.status === true) {
      const user = resExternal.data.user;

      const payloadRegis = {
        prefix: user.prefix || "Dr.",
        first_name: user.firstname,
        last_name: user.lastname,
        email_address: user.email, // This is our input
        password: password,
        phonenumber: user.phonenumber || "-",
        birthday: user.birthday || "2001-01-01",
        login_method: user.login_method || "internal",
        address: user.address || {},
      };

      const newUser = await createUserInDB(payloadRegis);
      return { status: true, user: newUser };
    }
  } catch (error) {
    if (error.response) {
      // The server responded with a status code outside the 2xx range
      console.error("❌ External API Error Data:", error.response.data);
      console.error("❌ External API Status:", error.response.status);
    } else if (error.request) {
      console.error("❌ No response received from External API");
    } else {
      console.error("❌ Axios Setup Error:", error.message);
    }
    return error.response; // Return null so the local login can still try to proceed
  }
};

const loginEmployee = async (req, res) => {
  try {
    const { user_email, user_password } = req.body;
    console.log(`Attempting login for: ${user_email}`);

    // 1. ลองหา User ใน local Database ก่อน
    let user = await User.findOne({
      where: {
        email: user_email,
        role: "employee",
      },
    });

    // 2. ถ้าไม่เจอใน Local DB -> ไปเช็ค External และสร้าง User ใหม่
    if (!user) {
      console.log("User not found in local, checking external API...");
      const externalResponse = await callExternalLogin(
        user_email,
        user_password,
      );

      // เช็คว่า External Login ผ่านไหม (ต้องเช็ค status: true)
      if (!externalResponse || externalResponse.status !== true) {
        return res.status(401).json({
          status: false,
          message: "ไม่พบบัญชีผู้ใช้ หรือรหัสผ่านไม่ถูกต้อง (External Error)",
        });
      }

      user = await User.findOne({
        where: { email: user_email, role: "employee" },
      });

      console.log("New user registered and fetched for login session");
    }
    if (user && (await user.comparePassword(user_password))) {
      // ดึงข้อมูลการลงทะเบียนเรียน (Enrollments)
      const userEnrollments = await Enrollment.findAll({
        where: {
          user_id: user.user_id,
          status: ["success", "pending"],
        },
        attributes: [
          "course_id",
          "status",
          "payment_method",
          "createdAt",
          "complete_status",
          "price_at_purchase",
        ],
      });

      // สร้าง Token
      const payload = {
        id: user.id,
        role: user.role,
      };

      const accessToken = signAccessToken(payload);
      const refreshToken = signRefreshToken(payload);

      // อัปเดต Refresh Token ลง DB
      // await user.update({ refreshToken });

      // 4. ส่งข้อมูลกลับ (Login สำเร็จทันที)
      return res.json({
        message: "Login Success",
        accessToken,
        refreshToken,
        user: {
          user_id: user.user_id,
          first_name: user.first_name,
          last_name: user.last_name,
          email: user.email,
          role: user.role,
          enrollments: userEnrollments,
          imageURL: user.imageURL,
          birthday: user.birthday,
          email_address: user.email_address,
          phonenumber: user.phonenumber,
          address: user.address,
        },
      });
    } else {
      return res
        .status(401)
        .json({ status: false, message: "รหัสผ่านไม่ถูกต้อง" });
    }
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ message: "Login Error", error: err.message });
  }
};

const deactivateAccount = async (req, res) => {
  try {
    // รับ user_id จาก body ตามที่ Flutter ส่งมา (data: {"user_id": userId})
    const { user_id } = req.body;
    const cleanUserId = user_id.trim(); // ตัด space หัวท้าย
    console.log(`Searching for: "${cleanUserId}"`); // ใส่เครื่องหมายคำพูดเพื่อดูว่ามี space แฝงไหม

    const user = await User.findOne({ where: { user_id: cleanUserId } });

    if (!user) {
      return res.status(404).json({ status: false, message: "ไม่พบผู้ใช้งาน" });
    }

    // ปรับสถานะเป็น 1 (Deactive)
    await user.update({ deactive_user: 1 });

    return res.status(200).json({
      status: true,
      message: "ระงับการใช้งานบัญชีเรียบร้อยแล้ว",
    });
  } catch (err) {
    console.error("Deactivate User Error:", err);
    res
      .status(500)
      .json({ status: false, message: "เกิดข้อผิดพลาดเซิร์ฟเวอร์" });
  }
};

module.exports = {
  login,
  loginEmployee,
  loginGoogle,
  refreshToken,
  deactivateAccount,
  loginApple,
};
