const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const Notification = sequelize.define(
    "Notification",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      notiId: {
        type: DataTypes.STRING, // หรือ INTEGER ตามที่คุณสะดวก
        allowNull: false,
      },
      noti_ref_id: {
        type: DataTypes.STRING,
        allowNull: true, // หรือ false ขึ้นอยู่กับความต้องการ
        comment: "รหัสอ้างอิงสำหรับการแจ้งเตือนที่ใช้ฝั่ง Frontend",
      },
      user_id: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      fullname: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      expo_noti_token: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      body: {
        type: DataTypes.TEXT, // ใช้ TEXT เผื่อข้อความรายละเอียดยาว
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true, // เผื่อไว้เก็บ log ภายใน
      },
      date: {
        type: DataTypes.STRING, // เก็บเป็น "22-04-26" ตาม body ที่คุณส่งมา
        allowNull: true,
      },
      time: {
        type: DataTypes.STRING, // เก็บเป็น "15:40"
        allowNull: true,
      },
      reading_status: {
        type: DataTypes.BOOLEAN,
        defaultValue: false, // เริ่มต้นที่ยังไม่ได้อ่าน
      },
      major_lat: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      major_lng: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // --- ปรับปรุงพิกัดผู้ใช้ ---
      user_lat: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      user_lng: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      tableName: "notifications", // กำหนดชื่อ table ให้ตรงกับใน Obsidian
      timestamps: true, // เปิดใช้งานเพื่อเอา createdAt, updatedAt
      
    },
  );

  return Notification;
};
