const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const UserProgress = sequelize.define(
    "UserProgress",
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      user_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      course_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      station_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      video_name: {
        type: DataTypes.STRING(255), // ขยายขนาดเผื่อชื่อวิดีโอยาว
        allowNull: false, // ควรเป็น false เพราะเป็น Key สำคัญในการแยกวิดีโอ
      },
      last_watched_second: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      max_watched_second: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      progress_percent: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        validate: { min: 0, max: 100 },
      },
      is_completed: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
    },
    {
      tableName: "user_progress",
      timestamps: true,
      // 💡 เพิ่ม Indexes เพื่อให้ค้นหาได้เร็วขึ้น (Composite Index)
      indexes: [
        {
          unique: true, // ป้องกันข้อมูลซ้ำสำหรับ User คนเดิม ในคลิปเดิม
          fields: ["user_id", "course_id", "station_id", "video_name"],
        },
      ],
    },
  );

  return UserProgress;
};
