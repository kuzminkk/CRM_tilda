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

app.get("/get-patients", async (req, res) => {
  try {
    if (process.env.API_KEY && req.query.api_key !== process.env.API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const conn = await mysql.createConnection(dbConfig);

    const [rows] = await conn.execute(`
      SELECT 
        CONCAT(ptt_sername, ' ', ptt_name, ' ', IFNULL(ptt_patronymic, '')) AS ФИО,
        ptt_tel AS Телефон,
        COUNT(vst_id) AS Количество_визитов,
        ptt_birth AS Дата_рождения,
        MAX(vst_date) AS Дата_последнего_визита,
        ptt_date_creation AS Дата_добавления_в_систему
      FROM Patients p
      JOIN Visits v ON p.ptt_id = v.ptt_id_FK
      GROUP BY p.ptt_id, p.ptt_sername, p.ptt_name, p.ptt_patronymic, p.ptt_tel, p.tt_birth, p.ptt_date_creation
      ORDER BY p.ptt_id
    `);

    await conn.end();
    res.json(rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});


    await conn.end();
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API listening on port ${PORT}`));
