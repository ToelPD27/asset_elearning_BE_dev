const { StreamChat } = require("stream-chat");
const { Expo } = require("expo-server-sdk"); // นำเข้า SDK
const { Notification, User } = require("../model/index.js");
const nodemailer = require("nodemailer");

// สร้าง instance ของ Expo
let expo = new Expo();

const API_KEY = "73u9ndyaz67q"; // fix ไว้เลย
const API_SECRET =
  "5bnsx37f545r9jbvvqcj8j648uawuaryeeq33qu3h76gjewqkthn8hr3wzqjhxhy";

let transporter = nodemailer.createTransport({
  service: "Gmail",
  auth: {
    user: "developer.toel.pdm@gmail.com",
    pass: "szhg ftvf utvk mbso",
  },
});

function generateOTP(length) {
  const digits = "0123456789";
  let OTP = "";
  for (let i = 0; i < length; i++) {
    OTP += digits[Math.floor(Math.random() * 10)];
  }
  return OTP;
}

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

exports.sendOTP = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "No recipient email provided" });
  }

  const existingUser = await User.findOne({ where: { email: email } });

  if (!existingUser) {
    return res.status(404).json({ message: "No user found with that email" });
  }

  try {
    const OTP = generateOTP(6);

    let mailOptions = {
      from: "developer.toel.pdm@gmail.com", // ปรับให้เข้ากับชื่อระบบ Asset eLearning
      to: existingUser.email_address,
      subject: `[Asset eLearning] Your OTP Verification Code - ${OTP}`,
      html: `
        <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; text-align: center; background-color: #f4f6f9; padding: 40px 20px; color: #333333;">
          <div style="background-color: #ffffff; border: 1px solid #e1e8ed; border-radius: 16px; display: inline-block; text-align: left; max-width: 450px; w-full; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
            
           

            <div style="padding: 32px 24px; text-align: center;">
              <h2 style="color: #1e3a8a; margin-top: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">ยืนยันรหัส OTP ของคุณ</h2>
              <p style="font-size: 15px; color: #4b5563; line-height: 1.6; margin-bottom: 24px;">
                สวัสดีครับ,<br>
                โปรดใช้รหัส OTP ด้านล่างนี้เพื่อยืนยันตัวตนในการเข้าใช้งานระบบ **Asset eLearning**
              </p>
              
              <div style="background-color: #f0f4f8; border-radius: 12px; padding: 16px; margin: 24px 0; border: 1px dashed #cbd5e1;">
                <span style="font-size: 32px; font-weight: bold; color: #1d4ed8; letter-spacing: 6px; padding-left: 6px;">${OTP}</span>
              </div>
              
              <p style="font-size: 13px; color: #9ca3af; margin-bottom: 0;">
                *รหัสผ่านนี้มีอายุการใช้งาน 10 นาที เพื่อความปลอดภัยโปรดอย่าเปิดเผยรหัสนี้แก่บุคคลอื่น
              </p>
            </div>
          </div>
          
          <div style="font-size: 12px; color: #6b7280; margin-top: 24px; text-align: center; line-height: 1.5;">
            <p style="margin: 0 0 4px 0;">ขอขอบพระคุณที่ใช้บริการระบบคลังการเรียนรู้ของเรา</p>
            <p style="margin: 0; font-weight: 600; color: #4b5563;">© Asset eLearning Platform</p>
          </div>
        </div>
      `,
    };

    console.log("Sending OTP email to:", existingUser.email_address); // แก้ไขจาก ToEmail เป็น email
    await transporter.sendMail(mailOptions);

    // ส่งข้อมูลสำเร็จกลับไปหา Client (ใน Production จริงไม่ควรส่งค่า otp กลับไปใน response json เพื่อความปลอดภัย)
    return res.status(200).json({
      message: "OTP sent successfully",
      otp: OTP,
      email: existingUser.email_address,
    });
  } catch (error) {
    console.error("Error in sendOTP service:", error);
    return res
      .status(500)
      .json({ message: "Internal server error code while sending email" });
  }
};

exports.create_checkout_session = async (req, res) => {
  const {
    cart,
    userId,
    paymentMethod,
    discount,
    finalTotal,
    deliveryMethod,
    branchName,
  } = req.body;
  console.log("paymentMethod:", paymentMethod);

  const truncateTwoDecimals = (num) => Math.floor(num * 100) / 100;

  let lineItems = [];

  // ✅ ถ้ามี finalTotal (เช่นราคาหลังหักส่วนลดทั้งหมด)
  if (finalTotal && finalTotal > 0) {
    console.log("🧮 Using finalTotal:", finalTotal);

    lineItems = [
      {
        price_data: {
          currency: "thb",
          product_data: {
            name: "ยอดรวมสินค้าทั้งหมด",
            images: cart[0]?.product?.images?.length
              ? [cart[0].product.images[0].secure_url]
              : [],
          },
          unit_amount: Math.floor(truncateTwoDecimals(finalTotal) * 100), // แปลงเป็นสตางค์
        },
        quantity: 1,
      },
    ];
  } else {
    // ✅ ถ้าไม่มี finalTotal ให้ใช้ราคาต่อสินค้าแทน
    console.log("🧾 Using per-item price instead");
    lineItems = cart.map((item) => {
      const unitAmount = Math.floor(truncateTwoDecimals(item.price) * 100);

      return {
        price_data: {
          currency: "thb",
          product_data: {
            name: item.product?.title || item.title,
            images: item.product?.images?.length
              ? [item.product.images[0].secure_url]
              : [],
          },
          unit_amount: unitAmount,
        },
        quantity: item.count,
      };
    });
  }

  console.log("lineItems:", lineItems);

  try {
    // สร้าง Checkout Session บน Stripe
    const session = await stripe.checkout.sessions.create({
      payment_method_types: [paymentMethod],
      line_items: lineItems,
      mode: "payment",
      success_url: `http://localhost:5173/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `http://localhost:5173/cancel`,
      // success_url: `https://www.360healthyshop.com/success?session_id={CHECKOUT_SESSION_ID}`,
      // cancel_url: `https://www.360healthyshop.com/cancel`,
      client_reference_id: userId,
      metadata: {
        couponCode: couponCode || "",
        couponDiscount: couponDiscount?.toString() || "0",
        deliveryMethod: deliveryMethod || "homeDelivery",
        branchName: branchName || "",
      },
    });

    res.json({ sessionId: session.id });
  } catch (error) {
    console.error("Error creating checkout session:", error);
    res.status(500).json({ error: error.message });
  }
};
