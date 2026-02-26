const jwt = require("jsonwebtoken");

// 1. Middleware กลางสำหรับตรวจสอบว่ามี Token ที่ถูกต้องไหม
const verifyToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  console.log("token verifyToken : ", token);
  if (!token) {
    return res
      .status(401)
      .json({ message: "Access Denied: No Token Provided" });
  }

  jwt.verify(token, process.env.JWT_ACCESS_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: "Token Invalid or Expired" });
    }

    // เก็บข้อมูล user ไว้ใน request เพื่อให้ middleware ตัวถัดไปใช้ได้
    req.user = decoded;
    next();
  });
};

// เพิ่มฟังก์ชันนี้ในไฟล์ middleware ของคุณ
const identifyUser = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  console.log("token identifyUser : ", token);
  if (!token) {
    req.user = null; // ถ้าไม่มี token ก็ปล่อยผ่านแต่ให้ user เป็น null
    return next();
  }

  jwt.verify(token, process.env.JWT_ACCESS_SECRET, (err, decoded) => {
    // ถ้า token เน่า หรือ expired ก็ให้เป็น null ไปเลย (ไม่บล็อก)
    req.user = err ? null : decoded;
    next();
  });
};

// 2. Middleware สำหรับเช็ก Role แบบไดนามิก
const authorize = (roles = []) => {
  if (typeof roles === "string") {
    roles = [roles];
  }

  return (req, res, next) => {
    // ต้องผ่าน verifyToken มาก่อน ถึงจะมี req.user
    if (!req.user || (roles.length && !roles.includes(req.user.role))) {
      return res
        .status(403)
        .json({ message: "Forbidden: You do not have permission" });
    }
    next();
  };
};

// ส่งออกให้เรียกใช้ง่ายๆ
module.exports = {
  identifyUser,
  verifyToken,
  authAdmin: [verifyToken, authorize("Admin")],
  // authEmployee: [verifyToken, authorize(["Admin", "employee"])],
  authUser: [verifyToken, authorize(["Admin", "employee", "user"])],
};
