const sequelize = require("../config/db_config.js");
const UserModel = require("./user.js");
const CategoryModel = require("./category.js");
const CourseModel = require("./course.js");
const StationModel = require("./station.js");
const EnrollmentModel = require("./enrollment.js");
const User_progressModel = require("./user_progress.js");
const NotificationModel = require("./notification.js");

const User = UserModel(sequelize);
const Category = CategoryModel(sequelize);
const Course = CourseModel(sequelize);
const Station = StationModel(sequelize);
const Enrollment = EnrollmentModel(sequelize);
const User_Progress = User_progressModel(sequelize);
const Notification = NotificationModel(sequelize);

// 2. Define Associations (แบบ String-based)

// Category <-> Course
Category.hasMany(Course, {
  foreignKey: "category_id",
  sourceKey: "category_id", // อ้างอิงจากคอลัมน์ category_id ในตาราง Category
  as: "courses",
});
Course.belongsTo(Category, {
  foreignKey: "category_id",
  targetKey: "category_id", // ไปยังคอลัมน์ category_id ในตาราง Category
  as: "category",
});

// Course <-> Station
Course.hasMany(Station, {
  foreignKey: "course_id",
  sourceKey: "course_id", // ใช้ 'CRS001' เชื่อม
  as: "stations",
});
Station.belongsTo(Course, {
  foreignKey: "course_id",
  targetKey: "course_id",
  as: "course",
});

// User <-> Enrollment (ใช้รหัสผู้ใช้ String)
User.hasMany(Enrollment, {
  foreignKey: "user_id",
  sourceKey: "user_id",
  as: "enrollments",
});
Enrollment.belongsTo(User, {
  foreignKey: "user_id",
  targetKey: "user_id",
  as: "user",
});

// Enrollment <-> Course
Course.hasMany(Enrollment, {
  foreignKey: "course_id",
  sourceKey: "course_id",
  as: "enrolled_users",
});
Enrollment.belongsTo(Course, {
  foreignKey: "course_id",
  targetKey: "course_id",
  as: "course",
});

// User <-> User_Progress
User.hasMany(User_Progress, {
  foreignKey: "user_id",
  sourceKey: "user_id",
  as: "progresses",
});
User_Progress.belongsTo(User, {
  foreignKey: "user_id",
  targetKey: "user_id",
  as: "user",
});

// Station <-> User_Progress
Station.hasMany(User_Progress, {
  foreignKey: "station_id",
  sourceKey: "station_id",
  as: "station_progresses",
});
User_Progress.belongsTo(Station, {
  foreignKey: "station_id",
  targetKey: "station_id",
  as: "station",
});

const syncDB = async () => {
  // ตั้งค่า logging ให้แสดงเวลา 12:34:00 นำหน้า SQL
  sequelize.options.logging = (msg) => {
    const time = new Date().toLocaleString("th-TH", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: "Asia/Bangkok",
    });
    console.log(`\x1b[90m${time}\x1b[0m ${msg}`); // \x1b[90m คือสีเทา
  };

  try {
    await sequelize.sync({ alter: true });
    // ใช้ console.log ของเดิมที่คุณต้องการ (จะเห็นเวลาตามที่ตั้งไว้ใน logging)
    console.log("✅ Sequelize synced with String-based associations");
  } catch (err) {
    console.error("❌ Sequelize sync error:", err);
    process.exit(1);
  }
};

module.exports = {
  sequelize,
  User,
  Category,
  Course,
  Station,
  Enrollment,
  User_Progress,
  Notification,
  syncDB,
};
