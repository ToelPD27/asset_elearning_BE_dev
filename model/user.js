const { DataTypes } = require("sequelize");
const bcrypt = require("bcryptjs");

module.exports = (sequelize) => {
  const User = sequelize.define(
    "User",
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      user_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: "idx_unique_user_id",
      },
      prefix: {
        type: DataTypes.ENUM("Mr.", "Ms.", "Mrs.", "Dr."),
        allowNull: true,
      },
      first_name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      last_name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: "idx_unique_email",
        validate: { isEmail: true },
      },
      email_address: {
        type: DataTypes.STRING(100),
        allowNull: true,
        unique: "idx_unique_email_google",
        validate: { isEmail: true },
        comment: "อีเมลสำหรับใช้ส่งข่าวสารหรือติดต่อ",
      },
      password: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      // --- เพิ่มฟิลด์วันเกิดตรงนี้ ---
      birthday: {
        type: DataTypes.DATEONLY, // เก็บเฉพาะ YYYY-MM-DD
        allowNull: true,
        comment: "วันเกิดของผู้ใช้งาน",
      },
      imageURL: {
        type: DataTypes.STRING(255),
        allowNull: true,
        defaultValue:
          "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png", // (Optional) ใส่รูป Default ไว้ได้
        comment: "URL ของรูปภาพโปรไฟล์",
      },
      // -----------------------
      phonenumber: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      role: {
        type: DataTypes.ENUM("user", "employee", "Admin"),
        allowNull: false,
        defaultValue: "user",
      },
      login_method: {
        type: DataTypes.ENUM("internal", "google_email"),
        allowNull: false,
        defaultValue: "internal",
      },
      refreshToken: {
        type: DataTypes.TEXT,
        allowNull: true, // ใช้สำหรับระบบ Auto Login
      },
      deactive_user: {
        type: DataTypes.TINYINT(1),
        allowNull: false,
        defaultValue: 0,
        comment: "0 = Active, 1 = Deactive",
      },
      address: {
        type: DataTypes.JSON,
        allowNull: true,
        get() {
          const rawValue = this.getDataValue("address");
          if (!rawValue) return {}; // สำหรับ address คืนค่าเป็น Object ว่างจะเหมาะสมกว่า Array ว่าง
          try {
            return typeof rawValue === "string"
              ? JSON.parse(rawValue)
              : rawValue;
          } catch (e) {
            return {}; // ถ้าข้อมูลพัง คืนค่า Object ว่างป้องกัน Frontend พัง
          }
        },
        // set(value) {
        //   // แปลง Object ให้เป็น String ก่อนบันทึกลง Longtext ของ MariaDB
        //   this.setDataValue("address", value ? JSON.stringify(value) : null);
        // },
      },
    },
    {
      tableName: "users",
      timestamps: true,
      createdAt: "createdAt",
      updatedAt: "updatedAt",
      hooks: {
        beforeCreate: async (user) => {
          if (user.password) {
            user.password = await bcrypt.hash(user.password, 10);
          }
        },
        beforeUpdate: async (user) => {
          if (user.changed("password") && user.password) {
            user.password = await bcrypt.hash(user.password, 10);
          }
        },
      },
    },
  );

  // ฟังก์ชันสำหรับเปรียบเทียบรหัสผ่าน (ใช้ตอน Login)
  User.prototype.comparePassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
  };

  return User;
};
