const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const Enrollment = sequelize.define(
    "Enrollment",
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      // Matches User Primary Key
      user_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
        comment: "Reference to User ID",
      },
      // Matches Course Primary Key
      course_id: {
        type: DataTypes.STRING(50),
        allowNull: false,
        comment: "Reference to Course Code (e.g., CRS001)",
      },
      payment_method: {
        type: DataTypes.ENUM("slip", "auto_payment", "free"),
        allowNull: false,
        defaultValue: "slip",
      },
      payment_proof: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "URL/Path to payment receipt image",
      },
      price_at_purchase: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0.0,
        comment: "Snapshot of price at time of purchase",
      },
      status: {
        type: DataTypes.ENUM("pending", "success", "cancelled"),
        allowNull: false,
        defaultValue: "pending",
      },
      complete_status: {
        type: DataTypes.ENUM("learning", "complete"),
        allowNull: false,
        defaultValue: "learning",
      },
      cancel_reason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "enrollments",
      timestamps: true,
      // Useful if you want to keep records of cancelled/deleted enrollments
      paranoid: false,
    },
  );

  return Enrollment;
};
