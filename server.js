require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const cookieParser = require("cookie-parser");

const { syncDB } = require("./model/index.js");

const app = express();
const port = 2030;

// --- 1. สร้าง Token สำหรับดึงเวลาปัจจุบัน (HH:mm:ss) ---
morgan.token("time", () => {
  return new Date().toLocaleString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Bangkok",
  });
});

// --- 2. ฟังก์ชันช่วยแสดง Log พร้อมเวลาสำหรับ console.log ทั่วไป ---
const logWithTime = (message) => {
  const time = new Date().toLocaleString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Bangkok",
  });
  console.log(`${time} ${message}`);
};

async function startServer() {
  try {
    await syncDB();
    logWithTime("📊 Database synced successfully.");

    app.use(cors());

    // --- 3. ปรับรูปแบบ Morgan Log ให้แสดงเวลา ---
    // รูปแบบ: 12:34:00 GET /api/getCourse 200 - 5.151 ms
    app.use(
      morgan((tokens, req, res) => {
        const status = tokens.status(req, res);

        // เลือกสีตาม Status Code
        let statusColor = "\x1b[0m";
        if (status >= 500)
          statusColor = "\x1b[31m"; // 5xx = แดง
        else if (status >= 400)
          statusColor = "\x1b[33m"; // 4xx = เหลือง
        else if (status >= 300)
          statusColor = "\x1b[36m"; // 3xx = ฟ้า (304)
        else if (status >= 200) statusColor = "\x1b[32m"; // 2xx = เขียว

        return [
          `[${tokens.time(req, res)}]`, // ใส่ [ ] ครอบเวลา
          `\x1b[35m${tokens.method(req, res)}\x1b[0m`, // Method สีชมพู
          tokens.url(req, res),
          `${statusColor}${status}\x1b[0m`, // Status แบบมีสี
          tokens.res(req, res, "content-length") || "-",
          "-",
          `${tokens["response-time"](req, res)} ms`,
        ].join(" ");
      }),
    );

    // 1. ขยาย limit ของ bodyParser เป็น 500mb
    app.use(bodyParser.json({ limit: "500mb" }));
    app.use(bodyParser.urlencoded({ limit: "500mb", extended: true }));

    app.use(cookieParser());
    app.use(express.json());

    const routesPath = path.join(__dirname, "routes");

    fs.readdirSync(routesPath).forEach((file) => {
      if (file.endsWith(".js")) {
        const router = require(`./routes/${file}`);

        if (typeof router !== "function") {
          console.error(
            `${new Date().toLocaleTimeString()} ❌ Route ${file} does not export a router function`,
          );
          return;
        }

        app.use("/api", router);
        logWithTime(`✅ Loaded route: /api/${file}`);
      }
    });

    app.listen(port, "0.0.0.0", () => {
      logWithTime(`🚀 Server running on port ${port}`);
    });
  } catch (error) {
    console.error(
      `${new Date().toLocaleTimeString()} ❌ Error starting server:`,
      error,
    );
  }
}

startServer();
