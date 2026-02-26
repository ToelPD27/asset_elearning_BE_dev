// config/sequelize.js
const { Sequelize } = require("sequelize");

const sequelize = new Sequelize(
  process.env.DB_NAME,
  // process.env.DB_USER_PRODUCT,
  process.env.DB_USER,
  // process.env.DB_PASSWORD_PRODUCT,
  process.env.DB_PASSWORD,
  {
    // host: process.env.DB_HOST_PRODUCT,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    dialect: "mysql",
    logging: console.log,
    dialectOptions: {
      connectTimeout: 60000,
      allowPublicKeyRetrieval: true,
    },
    timezone: "+07:00",
  },
);

// ✅ แก้ไขจาก export default sequelize; เป็นบรรทัดนี้:
module.exports = sequelize;
