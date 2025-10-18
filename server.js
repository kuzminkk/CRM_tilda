import express from "express";
import mysql from "mysql2/promise";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// Настройка CORS: укажи домен своего сайта на Tilda вместо '*'
const allowedOrigin = process.env.CORS_ORIGIN || "*";
app.use(cors({
  origin: allowedOrigin,
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
    // Пример параметра фильтра (например slug или id)
    const { id, key } = req.query;

    // Опциональная простая авторизация по ключу
    if (process.env.API_KEY && req.query.api_key !== process.env.API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const conn = await mysql.createConnection(dbConfig);

    // Пример безопасного запроса с параметром (замени table/columns на свои)
    let rows;
    if (id) {
      const [r] = await conn.execute("SELECT id, title, description FROM your_table WHERE id = ? LIMIT 1", [id]);
      rows = r;
    } else {
      const [r] = await conn.execute("SELECT id, title, description FROM your_table LIMIT 50");
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
