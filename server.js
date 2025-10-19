import express from "express";
import mysql from "mysql2/promise";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// ✅ Разрешённые источники (Тильда)
const allowedOrigins = [
  "https://project16054216.tilda.ws",
  "http://project16054216.tilda.ws",
];

// ✅ CORS
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
  })
);

// ✅ Конфигурация БД
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
};

// ===============================
// 📘 GET /get-patients — выборка пациентов
// ===============================
app.get("/get-patients", async (req, res) => {
  try {
    if (process.env.API_KEY && req.query.api_key !== process.env.API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const conn = await mysql.createConnection(dbConfig);

    const [rows] = await conn.execute(`
      SELECT 
        CONCAT(p.ptt_sername, ' ', p.ptt_name, ' ', IFNULL(p.ptt_patronymic, '')) AS ФИО,
        p.ptt_tel AS Телефон,
        COUNT(v.vst_id) AS Количество_визитов,
        p.ptt_birth AS Дата_рождения,
        MAX(v.vst_date) AS Дата_последнего_визита,
        p.ptt_date_creation AS Дата_добавления_в_систему
      FROM Patients p
      LEFT JOIN Visits v ON p.ptt_id = v.ptt_id_FK
      GROUP BY p.ptt_id, p.ptt_sername, p.ptt_name, p.ptt_patronymic, p.ptt_tel, p.ptt_birth, p.ptt_date_creation
      ORDER BY p.ptt_id
    `);

    await conn.end();
    res.json(rows);
  } catch (err) {
    console.error("Ошибка в /get-patients:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});

// ===============================
// 🦷 GET /get-visit-info — данные по визитам конкретного пациента
// ===============================
app.get("/get-visit-info", async (req, res) => {
  const { lastname, firstname, patronymic, api_key } = req.query;

  if (process.env.API_KEY && api_key !== process.env.API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!lastname || !firstname) {
    return res.status(400).json({ error: "Не указаны фамилия и имя" });
  }

  const conn = await mysql.createConnection(dbConfig);

  try {
    const [rows] = await conn.execute(
      `
      SELECT 
        CONCAT(ptt.ptt_sername, ' ', ptt.ptt_name, ' ', IFNULL(ptt.ptt_patronymic, '')) AS ФИО_пациента,
        vss.vss_type AS Статус_визита,
        vst.vst_date AS Дата_визита,
        vst.vst_timestrart AS Начало_визита,
        vst.vst_timeend AS Конец_визита,
        CONCAT(emp.ele_sername, ' ', emp.ele_name, ' ', IFNULL(emp.ele_patronymic, '')) AS ФИО_врача,
        vte.vte_type AS Тип_визита,
        vst.vst_note AS Комментарий_к_визиту,
        ds.dse_name AS Наименование_услуги,
        vds.vds_quantity AS Количество_услуг,
        vds.vds_discount AS Скидка_на_услугу,
        ds.dse_price AS Цена_услуги,
        vds.vds_total_amount AS Сумма_за_услугу,
        vst.vst_discount AS Скидка_на_визит,
        vst.vst_final_sumservice AS Итоговая_сумма_визита,
        pv.pvt_payment AS Итоговая_сумма_оплаты_визита,
        pm.pmd_name AS Способ_оплаты_визита
      FROM Visits vst
      JOIN Patients ptt ON vst.ptt_id_FK = ptt.ptt_id
      JOIN Visit_Statuses vss ON vst.vss_id_FK = vss.vss_id
      JOIN Employees emp ON vst.ele_id_FK = emp.ele_id
      JOIN Visit_Types vte ON vst.vte_id_FK = vte.vte_id
      JOIN Visit_Dental_Services vds ON vst.vst_id = vds.vst_id_FK
      JOIN Dental_Services ds ON vds.dse_id_FK = ds.dse_id
      JOIN Paymet_Visits pv ON vst.vst_id = pv.vst_id_FK
      JOIN Payment_Methods pm ON pv.pmd_id_FK = pm.pmd_id
      WHERE ptt.ptt_sername = ? 
        AND ptt.ptt_name = ?
        AND (ptt.ptt_patronymic = ? OR ? IS NULL)
      ORDER BY vst.vst_date DESC
      `,
      [lastname, firstname, patronymic || null, patronymic || null]
    );

    await conn.end();
    res.json(rows);
  } catch (err) {
    console.error("Ошибка в /get-visit-info:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});

// ===============================
// 🩺 POST / — добавление пациента с формы Тильды
// ===============================
app.post("/", async (req, res) => {
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
    const [patientResult] = await conn.execute(
      `
      INSERT INTO Patients (
        ptt_sername, ptt_name, ptt_patronymic, ptt_photo,
        ptt_birth, ptt_gender, ptt_tel, ptt_address, ptt_email,
        ptt_policyOMS, ptt_snils, ptt_passport_number, ptt_passport_series, ptt_date_of_issue,
        ptt_disability, ptt_allergy, ptt_diseases, ptt_complaints,
        ptt_date_creation, cdt_id_FK
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?)
    `,
      [
        data.lastname,
        data.firstname,
        data.patronymic || null,
        data.file || null,
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
        contractId,
      ]
    );

    const patientId = patientResult.insertId;

    // 3️⃣ Привязка категории пациента (например, “Взрослый” = id 5)
    await conn.execute(
      `
      INSERT INTO Patient_Categories (ptt_id_FK, cty_id_FK)
      VALUES (?, ?)
    `,
      [patientId, 5]
    );

    // 4️⃣ Если прикреплён файл (PDF или фото документа)
    if (data.file && data.fileName) {
      await conn.execute(
        `
        INSERT INTO Documents (dct_name, dct_dateupload, dct_document, ptt_id_FK)
        VALUES (?, CURDATE(), ?, ?)
      `,
        [data.fileName, data.file, patientId]
      );
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

// ===============================
// 🚀 Запуск сервера
// ===============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ API listening on port ${PORT}`));
