const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const Category = sequelize.define(
    "Category",
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      category_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: "idx_unique_category_id",
        comment: "รหัสหมวดหมู่ เช่น CAT001",
      },
      category_name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: "idx_unique_category_name",
      },
    },
    {
      tableName: "categories", // ใช้ชื่อพหูพจน์ตามมาตรฐาน
      timestamps: true,
      createdAt: "createdAt",
      updatedAt: "updatedAt",
    },
  );

  return Category;
};
