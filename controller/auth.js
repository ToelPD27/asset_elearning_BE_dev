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

      // ===== แก้ไข: เพิ่ม try/catch ครอบ logic ข้างใน callback =====
      try {
        const user = await User.findByPk(decoded.id);
        if (!user) return res.status(404).json({ message: "ไม่พบผู้ใช้งาน" });

        // ถ้าเป็น employee ให้ refresh external token คู่กันไปด้วย
        if (user.role === "employee" && user.refreshToken_External) {
          const externalResult = await refreshTokenExternal(
            user.refreshToken_External,
          );

          if (externalResult.status === true) {
            await user.update({
              accessToken_External: externalResult.accessToken,
              refreshToken_External:
                externalResult.refreshToken || user.refreshToken_External,
            });
            // console.log("External token refreshed successfully for employee");
          } else {
            // Refresh external ไม่ผ่าน (เช่น refreshToken หมดอายุ)
            // ไม่ block การ refresh local token แต่ log ไว้เพื่อรู้ว่า external token ค้าง/หมดอายุ
            console.warn(
              `External refresh failed for user ${user.id}, external token may be stale`,
            );
          }
        }

        // 1. เจน Access Token ใหม่ (local)
        const newAccessToken = signAccessToken({
          id: user.id,
          role: user.role,
        });

        // 2. เจน Refresh Token ใหม่ (local)
        const newRefreshToken = signRefreshToken({
          id: user.id,
          role: user.role,
        });

        const userEnrollments = await Enrollment.findAll({
          where: { user_id: user.user_id, status: ["success", "pending"] },
          attributes: ["course_id", "status"],
        });

        return res.json({
          message: "Token Refreshed Success",
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          accessToken_External: user.accessToken_External,
          refreshToken_External: user.refreshToken_External,
          user: {
            user_id: user.user_id,
            first_name: user.first_name,
            role: user.role,
            enrollments: userEnrollments,
          },
        });
      } catch (innerErr) {
        console.error("Refresh inner error:", innerErr);
        return res
          .status(500)
          .json({ message: "Refresh error", error: innerErr.message });
      }
      // ===== จบส่วนที่แก้ไข =====
    });
  } catch (err) {
    res.status(500).json({ message: "Refresh error", error: err.message });
  }
};

const callExternalLogin = async (email, password) => {
  try {
    const payload = {
      user_email: email,
      user_password: password,
    };

    const resExternal = await axios.post(
      "https://dev-api.uniquecarestationthailand.com/api/prizemed/user/login",
      payload,
      {
        headers: { "Content-Type": "application/json" },
      },
    );

    console.log("External API response:", resExternal.data);

    if (resExternal.data.status === true) {
      const user = resExternal.data.user;

      const payloadRegis = {
        iduser_External: user.iduser,
        accessToken_External: resExternal.data.accessToken, // แก้แล้ว
        refreshToken_External: resExternal.data.refreshToken,
        prefix: user.prefix || "Dr.",
        first_name: user.firstname,
        last_name: user.lastname,
        email_address: user.email,
        password: password,
        phonenumber: user.phonenumber || "-",
        birthday: user.birthday || "2001-01-01",
        login_method: user.login_method || "internal",
        address: user.address || {},
      };
      // console.log("Payload for local DB sync:", payloadRegis);
      const newUser = await createUserInDB(payloadRegis);
      // console.log("User created or updated in local DB:", newUser);
      return {
        status: true,
        user: newUser,
        externalResponse: resExternal.data,
      };
    }

    return { status: false };
  } catch (error) {
    if (error.response) {
      console.error("❌ External API Error Data:", error.response.data);
      console.error("❌ External API Status:", error.response.status);
    } else if (error.request) {
      console.error("❌ No response received from External API");
    } else {
      console.error("❌ Axios Setup Error:", error.message);
    }
    return { status: false, error: error.response?.data };
  }
};

const loginEmployee = async (req, res) => {
  try {
    const { user_email, user_password } = req.body;
    // console.log(`Attempting login for: ${user_email} , ${user_password}`);

    // เรียก external login ทุกครั้ง เพื่อยืนยันตัวตนและ sync token ล่าสุดเสมอ
    const externalResponse = await callExternalLogin(user_email, user_password);
    // console.log("External login response:", externalResponse);

    if (!externalResponse || externalResponse.status !== true) {
      return res.status(401).json({
        status: false,
        message: "ไม่พบบัญชีผู้ใช้ หรือรหัสผ่านไม่ถูกต้อง (External Error)",
      });
    }

    // externalResponse.user มาจาก createUserInDB
    // - ถ้ายังไม่มี user ในระบบ -> สร้างใหม่
    // - ถ้ามีอยู่แล้ว -> อัปเดต external token ให้ล่าสุด แล้ว return user เดิม (ไม่สร้างซ้ำ)
    const user = externalResponse.user;

    if (!user) {
      return res.status(500).json({
        status: false,
        message: "เกิดข้อผิดพลาดในการดึงข้อมูลผู้ใช้",
      });
    }

    if (await user.comparePassword(user_password)) {
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

      // สร้าง Token (local)
      const payload = {
        id: user.id,
        role: user.role,
      };

      const accessToken = signAccessToken(payload);
      const refreshTok = signRefreshToken(payload);

      const responsePayload = {
        message: "Login Success",
        accessToken,
        refreshToken: refreshTok,
        accessToken_External: user.accessToken_External,
        refreshToken_External: user.refreshToken_External,
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
      };

      // console.log("Login success, sending response:", responsePayload);

      return res.json(responsePayload);
    } else {
      // console.log(`Password mismatch for: ${user_email}`);
      return res
        .status(401)
        .json({ status: false, message: "รหัสผ่านไม่ถูกต้อง" });
    }
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ message: "Login Error", error: err.message });
  }
};

const refreshTokenExternal = async (externalRefreshToken) => {
  try {
    const resExternal = await axios.post(
      "https://dev-api.uniquecarestationthailand.com/api/prizemed/auth/refresh",
      { refreshToken: externalRefreshToken },
      { headers: { "Content-Type": "application/json" } },
    );

    if (resExternal.data.accessToken) {
      return {
        status: true,
        accessToken: resExternal.data.accessToken,
        refreshToken: resExternal.data.refreshToken,
      };
    }

    return { status: false };
  } catch (error) {
    if (error.response) {
      console.error("❌ External Refresh Error Data:", error.response.data);
      console.error("❌ External Refresh Status:", error.response.status);
    } else if (error.request) {
      console.error("❌ No response received from External Refresh API");
    } else {
      console.error("❌ Axios Setup Error:", error.message);
    }
    return { status: false };
  }
};

const deactivateAccount = async (req, res) => {
  try {
    // รับ user_id จาก body ตามที่ Flutter ส่งมา (data: {"user_id": userId})
    const { user_id } = req.body;
    const cleanUserId = user_id.trim(); // ตัด space หัวท้าย
    // console.log(`Searching for: "${cleanUserId}"`); // ใส่เครื่องหมายคำพูดเพื่อดูว่ามี space แฝงไหม

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

const check_email = async (req, res) => {
  try {
    const { email } = req.body; // เปลี่ยนจาก req.body เป็น req.query

    if (!email) {
      return res.status(400).json({ message: "กรุณาระบุอีเมล" });
    }

    const user = await User.findOne({
      where: { email, role: "employee" },
    });

    if (user) {
      return res
        .status(200)
        .json({ exists: true, message: "อีเมลนี้มีอยู่แล้ว" });
    } else {
      return res
        .status(200)
        .json({ exists: false, message: "อีเมลนี้ยังไม่มีในระบบ" });
    }
  } catch (err) {
    console.error("Check Email Error:", err);
    res.status(500).json({ message: "เกิดข้อผิดพลาดเซิร์ฟเวอร์" });
  }
};

const confirmLogin = async (req, res) => {
  try {
    const { email, accessToken_External, refreshToken_External } = req.body;

    // console.log(`Attempting confirmLogin for: ${email}`);

    if (!email || !accessToken_External || !refreshToken_External) {
      return res.status(400).json({
        status: false,
        message:
          "กรุณาระบุ email, accessToken_External และ refreshToken_External",
      });
    }

    // หา user จาก email ในระบบเรา
    let user = await User.findOne({ where: { email } });

    if (!user) {
      return res.status(404).json({
        status: false,
        message: "ไม่พบบัญชีผู้ใช้ในระบบ",
      });
    }

    // อัปเดต external token ให้เป็นตัวล่าสุดที่ frontend ส่งมา
    user.accessToken_External = accessToken_External;
    user.refreshToken_External = refreshToken_External;
    await user.save();

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

    // สร้าง Token (local)
    const payload = {
      id: user.id,
      role: user.role,
    };

    const accessToken = signAccessToken(payload);
    const refreshTok = signRefreshToken(payload);

    const responsePayload = {
      message: "Confirm Login Success",
      accessToken,
      refreshToken: refreshTok,
      accessToken_External: user.accessToken_External,
      refreshToken_External: user.refreshToken_External,
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
    };

    console.log("Confirm login success, sending response:", responsePayload);

    return res.json(responsePayload);
  } catch (err) {
    console.error("Confirm Login Error:", err);
    res
      .status(500)
      .json({ message: "Confirm Login Error", error: err.message });
  }
};

module.exports = {
  login,
  loginEmployee,
  loginGoogle,
  refreshToken,
  deactivateAccount,
  loginApple,
  check_email,
  confirmLogin,
};
