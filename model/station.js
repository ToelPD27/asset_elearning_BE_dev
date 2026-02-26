const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const Station = sequelize.define(
    "Station",
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      station_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: "idx_unique_station_id",
        comment: "รหัสบทเรียน เช่น STN-001",
      },
      course_id: {
        type: DataTypes.STRING(50), // เปลี่ยนจาก INTEGER เป็น STRING
        allowNull: false,
        comment: "เชื่อมด้วยรหัสหลักสูตร เช่น CRS001",
      },
      station_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },

      videos: {
        type: DataTypes.JSON,
        allowNull: true,
        get() {
          const rawValue = this.getDataValue("videos");
          if (!rawValue) return [];
          try {
            return typeof rawValue === "string"
              ? JSON.parse(rawValue)
              : rawValue;
          } catch (e) {
            return [];
          }
        },
        // เพิ่มส่วนนี้เพื่อความชัวร์ตอน Save/Update
        set(value) {
          this.setDataValue(
            "videos",
            typeof value === "object" ? JSON.stringify(value) : value,
          );
        },
      },
    },
    {
      tableName: "stations",
      timestamps: true,
      createdAt: "createdAt",
      updatedAt: "updatedAt",
    },
  );

  return Station;
};
