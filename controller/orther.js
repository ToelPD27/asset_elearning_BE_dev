const { StreamChat } = require("stream-chat");
const { Expo } = require("expo-server-sdk"); // นำเข้า SDK
const { Notification } = require("../model/index.js");

// สร้าง instance ของ Expo
let expo = new Expo();

const API_KEY = "73u9ndyaz67q"; // fix ไว้เลย
const API_SECRET =
  "5bnsx37f545r9jbvvqcj8j648uawuaryeeq33qu3h76gjewqkthn8hr3wzqjhxhy";

exports.streamclientServer = async (req, res) => {
  const { user_id } = req.body;

  try {
    const serverClient = StreamChat.getInstance(API_KEY, API_SECRET);

    const token = serverClient.createToken(user_id);

    res.json({ token });
  } catch (error) {
    console.error("Error generating token:", error);
    res.status(500).json({ error: "Error generating token" });
  }
};

exports.sendPushNotification = async (req, res) => {
  const {
    notiId,
    date,
    time,
    expo_noti_token,
    user_id,
    fullname,
    majorlocation = {},
    userlocation = {},
  } = req.body;

  // 1. ตรวจสอบ Expo Token
  if (!Expo.isExpoPushToken(expo_noti_token)) {
    return res.status(400).json({ error: "Invalid Expo Push Token" });
  }

  // แปลงพิกัดเป็น String และกัน Error ด้วย Optional Chaining
  const major_lat = majorlocation?.major_lat
    ? `${majorlocation.major_lat}`
    : "0";
  const major_lng = majorlocation?.major_lng
    ? `${majorlocation.major_lng}`
    : "0";
  const user_lat = userlocation?.user_lat ? `${userlocation.user_lat}` : "0";
  const user_lng = userlocation?.user_lng ? `${userlocation.user_lng}` : "0";

  // ป้องกันกรณีชื่อเป็นค่าว่าง
  const displayFullname = fullname?.trim() ? fullname : "ลูกค้า";

  // 2. เตรียมตัวแปร
  let title = "";
  let messageBody = "";
  let generatedRefId = "";
  const timestamp = Date.now();

  // 3. Logic แยกตาม noticode
  if (notiId === "1") {
    title = "ยืนยันการจองคิว"; // โดยเจ้าหน้าที่
    messageBody = `เจ้าหน้าที่ยืนยันคิวของคุณ ${displayFullname} แล้ววันที่ ${date} เวลา ${time}`;
    generatedRefId = `CONF-${timestamp}`;
  } else if (notiId === "2") {
    title = "จองคิวเสร็จเรียบร้อย";
    messageBody = `คุณ ${displayFullname} ได้ทำการจองคิววันที่ ${date} เวลา ${time} เรียบร้อยแล้ว โปรดรอการติดต่อกลับจากเจ้าหน้าที่เพื่อยืนยันอีกครั้งครับ`;
    generatedRefId = `BOOK-${timestamp}`;
  } else if (notiId === "3") {
    title = "เสร็จสิ้นการรักษา";
    messageBody = `การรักษาของคุณ ${displayFullname} เสร็จสิ้นแล้วเมื่อเวลา ${time} ขอบคุณที่ใช้บริการ`;
    generatedRefId = `FINS-${timestamp}`;
  } else {
    title = "แจ้งเตือนใหม่";
    messageBody = `สวัสดีคุณ ${displayFullname} คุณได้รับข้อความใหม่จากระบบ`;
    generatedRefId = `GEN-${timestamp}`;
  }

  try {
    // 4. บันทึกลง MySQL (Sequelize)
    const savedNoti = await Notification.create({
      notiId,
      noti_ref_id: generatedRefId,
      user_id,
      fullname: displayFullname, // ใช้ชื่อที่ตรวจสอบแล้ว
      expo_noti_token,
      title,
      body: messageBody,
      date,
      time,
      reading_status: false,
      major_lat: major_lat,
      major_lng: major_lng, // ส่งค่าจาก major_lng ไปเข้า column major_lng
      user_lat: user_lat,
      user_lng: user_lng, // ส่งค่าจาก user_lng ไปเข้า column user_lng
    });

    // 5. เตรียมส่ง Notification
    let messages = [
      {
        to: expo_noti_token,
        sound: "default",
        title: title,
        body: messageBody,
        priority: "high", // ตัวนี้ช่วยเรื่องความเร็วและการปลุกเครื่อง
        channelId: "default", // <--- ต้องเพิ่มบรรทัดนี้ เพื่อให้ Android ยอมให้ "เด้ง" (Heads-up)
        data: {
          notiId: notiId,
          timestamp: timestamp,
          content: savedNoti,
        },
      },
    ];

    // 6. ส่งแบบ Chunk
    let chunks = expo.chunkPushNotifications(messages);
    for (let chunk of chunks) {
      try {
        await expo.sendPushNotificationsAsync(chunk);
      } catch (error) {
        console.error("Error sending chunk:", error);
      }
    }

    res.json({
      status: "success",
      message: "Notification sent and saved!",
      data: savedNoti,
    });
  } catch (error) {
    console.error("Database or SDK Error:", error);
    res.status(500).json({
      error: "Internal Server Error",
      details: error.message,
    });
  }
};

exports.getNotificationsByUserId = async (req, res) => {
  const { user_id } = req.params;

  try {
    // ดึงข้อมูลทั้งหมดที่ตรงกับ user_id
    const notifications = await Notification.findAll({
      where: {
        user_id: user_id,
      },
      // เรียงลำดับจาก ID มากไปน้อย (หรือใช้ createdAt ก็ได้) เพื่อให้ข้อมูลล่าสุดอยู่บนสุด
      order: [["createdAt", "DESC"]],
    });

    // ตรวจสอบว่ามีข้อมูลไหม
    if (!notifications || notifications.length === 0) {
      return res.status(200).json({
        status: "success",
        message: "No notifications found for this user",
        data: [],
      });
    }

    // ส่งข้อมูลกลับไป
    res.status(200).json({
      status: "success",
      count: notifications.length,
      data: notifications,
    });
  } catch (error) {
    console.error("Fetch Notifications Error:", error);
    res.status(500).json({
      error: "Internal Server Error",
      details: error.message,
    });
  }
};

exports.updateReadingStatus = async (req, res) => {
  const { user_id, noti_ref_id } = req.body;

  // 1. ตรวจสอบว่าส่งค่าที่จำเป็นมาครบหรือไม่
  if (!user_id || !noti_ref_id) {
    return res.status(400).json({
      error: "Missing required fields: user_id or noti_ref_id",
    });
  }

  try {
    // 2. ค้นหาและอัปเดต status โดยเช็คทั้ง ID และ User ID เพื่อความปลอดภัย (กันคนแอบแก้ Noti คนอื่น)
    const [updatedRows] = await Notification.update(
      { reading_status: true },
      {
        where: {
          noti_ref_id: noti_ref_id,
          user_id: user_id,
        },
      },
    );

    // 3. ตรวจสอบว่ามีการอัปเดตจริงไหม (ถ้าหาไม่เจอ updatedRows จะเป็น 0)
    if (updatedRows === 0) {
      return res.status(404).json({
        error: "Notification not found or already updated",
      });
    }

    // 4. ส่งผลลัพธ์กลับ
    res.json({
      status: "success",
      message: "Notification status updated to read",
      noti_ref_id: noti_ref_id,
    });
  } catch (error) {
    console.error("Update Status Error:", error);
    res.status(500).json({
      error: "Internal Server Error",
      details: error.message,
    });
  }
};
