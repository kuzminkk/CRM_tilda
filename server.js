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

const allowedOrigins = [
  "https://project16054216.tilda.ws",
  "http://project16054216.tilda.ws"
];

app.use(cors({
  origin: function(origin, callback){
    // Разрешаем, если origin пустой (например, fetch с Tilda) или в списке allowedOrigins
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
};

// Endpoint для пациентов
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
      GROUP BY p.ptt_id, ptt_sername, ptt_name, ptt_patronymic, ptt_tel, ptt_birth, ptt_date_creation
      ORDER BY p.ptt_id
    `);

    await conn.end();
    res.json(rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});


app.post("/", express.json(), async (req, res) => {
  const data = req.body;
  const conn = await mysql.createConnection(dbConfig);

  try {
    await conn.beginTransaction();

    // 1️⃣ Создаём запись в Contract_Documents
    const [docResult] = await conn.execute(`
      INSERT INTO Contract_Documents (cdt_date_creation)
      VALUES (CURDATE())
    `);
    const contractId = docResult.insertId;

    // 2️⃣ Добавляем пациента
    const [patientResult] = await conn.execute(`
      INSERT INTO Patients (
        ptt_sername, ptt_name, ptt_patronymic, ptt_photo,
        ptt_birth, ptt_gender, ptt_tel, ptt_address, ptt_email,
        ptt_policyOMS, ptt_snils, ptt_passport_number, ptt_passport_series, ptt_date_of_issue,
        ptt_disability, ptt_allergy, ptt_diseases, ptt_complaints,
        ptt_date_creation, cdt_id_FK
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?)
    `, [
      data.lastname,
      data.firstname,
      data.patronymic || null,
      data.file || null, // если фото профиля в base64
      data.birthdate || null,
      data.gender || "Не указано",
      data.phone || null,
      data.address || null,
      data.email || null,
      data.oms || null,
      data.snils || null,
      data.pass_number || null,
      data.pass_series || null,
      data.pass_issued || null,
      data.disability || null,
      data.allergies || null,
      data.comorbid || null,
      data.complaints || null,
      contractId
    ]);

    const patientId = patientResult.insertId;

    // 3️⃣ Привязка категории пациента (например, “Взрослый” = id 5)
    await conn.execute(`
      INSERT INTO Patient_Categories (pcy_id, ptt_id_FK, cty_id_FK)
      VALUES (NULL, ?, ?)
    `, [patientId, 5]);

    // 4️⃣ Если прикреплён файл (PDF или фото документа)
    if (data.file && data.fileName) {
      await conn.execute(`
        INSERT INTO Documents (dct_name, dct_dateupload, dct_document, ptt_id_FK)
        VALUES (?, CURDATE(), ?, ?)
      `, [
        data.fileName,
        data.file, // Base64
        patientId
      ]);
    }

    await conn.commit();
    res.status(200).json({ status: "ok", message: "Пациент успешно добавлен" });
  } catch (err) {
    await conn.rollback();
    console.error("Ошибка при вставке пациента:", err);
    res.status(500).json({ error: "Ошибка сервера", detail: err.message });
  } finally {
    await conn.end();
  }
});




// Старт сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API listening on port ${PORT}`));
