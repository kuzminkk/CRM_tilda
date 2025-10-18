import express from "express";
import mysql from "mysql2/promise";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

const allowedOrigins = [
  "https://project16054216.tilda.ws",
  "http://project16054216.tilda.ws"
];

app.use(cors({
  origin: function(origin, callback){
    // если запрос идёт с allowedOrigins или без origin (например, fetch с Tilda)
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  }
}));


const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  // Если твой провайдер MySQL требует TLS, добавь сюда опции ssl: { rejectUnauthorized: true, ca: ... }
};

app.get("/get-data", async (req, res) => {
  try {
    // Опциональная простая авторизация по ключу
    if (process.env.API_KEY && req.query.api_key !== process.env.API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const conn = await mysql.createConnection(dbConfig);

    let rows;

    // Если передан id — отдать конкретную запись
    if (req.query.id) {
      const [r] = await conn.execute(
        "SELECT acw_id, acw_date_creation FROM Act_Completed_Works WHERE acw_id = ? LIMIT 1",
        [req.query.id]
      );
      rows = r;
    } else {
      // Иначе — отдать первые 50 записей
      const [r] = await conn.execute(
        "SELECT acw_id, acw_date_creation FROM Act_Completed_Works ORDER BY acw_date_creation DESC LIMIT 50"
      );
      rows = r;
    }

    await conn.end();
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API listening on port ${PORT}`));
