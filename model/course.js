const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const Course = sequelize.define(
    "Course",
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      course_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: "idx_unique_course_id",
        comment: "รหัสหลักสูตร เช่น CRS001",
      },
      course_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      category_id: {
        type: DataTypes.STRING(50), // เปลี่ยนจาก INTEGER เป็น STRING
        allowNull: false,
        comment: "เชื่อมด้วยรหัสหลักสูตร เช่น CAT001",
      },
      count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: "จำนวนการซื้อหรือผู้สมัคร",
      },
      fee: {
        type: DataTypes.DECIMAL(10, 2), // รองรับทศนิยม เช่น 99.50
        allowNull: false,
        defaultValue: 0.0,
        comment: "ค่าธรรมเนียม (0 คือฟรี)",
      },
      detail: {
        type: DataTypes.TEXT, // ใช้ TEXT เพราะข้อมูลอาจจะยาวกว่า STRING
        allowNull: true,
      },
      image: {
        type: DataTypes.STRING(255), // เก็บเป็น Path หรือ URL ของรูปภาพ
        allowNull: true,
        defaultValue:
          "https://asset-image.uniquecarestationthailand.com/images/corevalue.png",
      },
      status: {
        type: DataTypes.ENUM("pending", "active", "inactive", "maintenance"),
        allowNull: false,
        defaultValue: "pending",
        comment:
          "สถานะคอร์ส: active=เปิดใช้งาน, inactive=ปิดใช้งาน, maintenance=ปิดปรับปรุง",
      },
    },
    {
      tableName: "courses",
      timestamps: true,
      createdAt: "createdAt", // ใช้ชื่อตามที่คุณระบุ
      updatedAt: "updatedAt", // แนะนำให้เปิดไว้เพื่อดูว่าคอร์สถูกแก้ไขล่าสุดเมื่อไหร่
    },
  );

  return Course;
};
