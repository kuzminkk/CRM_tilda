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
  "http://systemdental.tilda.ws"
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
// 👨‍💼 POST /add-employee — добавление сотрудника с формы
// ===============================
app.post("/add-employee", async (req, res) => {
  const data = req.body;
  const conn = await mysql.createConnection(dbConfig);

  try {
    await conn.beginTransaction();

    // Определяем ID должности по названию
    let positionId;
    const [positionRows] = await conn.execute(
      `SELECT psn_id FROM Positions WHERE psn_name = ?`,
      [data.position]
    );

    if (positionRows.length > 0) {
      positionId = positionRows[0].psn_id;
    } else {
      // Если должности нет - создаём новую
      const [newPosition] = await conn.execute(
        `INSERT INTO Positions (psn_name) VALUES (?)`,
        [data.position]
      );
      positionId = newPosition.insertId;
    }

    // Определяем статус сотрудника (уволен или активен)
    const employeeStatus = data.dismissed ? 1 : 2; // 1 - неактивен, 2 - активен

    // Преобразуем дату рождения из формата дд.мм.гггг в гггг-мм-дд
    let formattedBirthdate = null;
    if (data.birthdate) {
      const [day, month, year] = data.birthdate.split('.');
      formattedBirthdate = `${year}-${month}-${day}`;
    }

    // Преобразуем СНИЛС - убираем форматирование
    const cleanSnils = data.snils ? data.snils.replace(/\D/g, '') : null;

    // Добавляем сотрудника
    const [employeeResult] = await conn.execute(
      `
      INSERT INTO Employees (
        ele_sername, ele_name, ele_patronymic, ele_photo,
        psn_id_FK, ele_snils, ele_birth, ele_tel, ele_email,
        ele_INN, ele_description, ess_id_FK
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        data.lastname,
        data.firstname,
        data.patronymic || null,
        data.photo || null, // Base64 фото
        positionId,
        cleanSnils,
        formattedBirthdate,
        data.phone ? data.phone.replace(/\D/g, '') : null, // Очищаем телефон от форматирования
        data.email || null,
        data.inn || null,
        data.description || null,
        employeeStatus
      ]
    );

    const employeeId = employeeResult.insertId;

    // Если сотрудник должен отображаться в расписании, создаём для него рабочие расписания
    if (data.show_in_schedule && !data.dismissed) {
      // Создаём базовое рабочее расписание на ближайший месяц
      const startDate = new Date();
      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + 1);

      const workSchedules = [];
      const currentDate = new Date(startDate);
      
      // Создаём расписание на каждый рабочий день (пн-пт)
      while (currentDate <= endDate) {
        const dayOfWeek = currentDate.getDay();
        // Пн-Пт (1-5) - рабочие дни
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          const dateStr = currentDate.toISOString().split('T')[0];
          
          // Создаём запись в Work_Schedules
          const [scheduleResult] = await conn.execute(
            `INSERT INTO Work_Schedules (wse_calend_numb, wse_workstart, wse_workend, swk_id_FK)
             VALUES (?, '09:00:00', '18:00:00', 2)`, // 2 - активный статус
            [dateStr]
          );
          
          // Связываем сотрудника с расписанием
          await conn.execute(
            `INSERT INTO Employee_Work_Schedules (wse_id_FK, ele_id_FK)
             VALUES (?, ?)`,
            [scheduleResult.insertId, employeeId]
          );
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }

    await conn.commit();
    
    res.status(200).json({ 
      status: "success", 
      message: "Сотрудник успешно добавлен",
      employeeId: employeeId
    });
    
  } catch (err) {
    await conn.rollback();
    console.error("Ошибка при добавлении сотрудника:", err);
    res.status(500).json({ 
      error: "Ошибка сервера при добавлении сотрудника", 
      detail: err.message 
    });
  } finally {
    await conn.end();
  }
});

// ===============================
// 👥 GET /get-employees — выборка сотрудников для таблицы
// ===============================
app.get("/get-employees", async (req, res) => {
  try {
    if (process.env.API_KEY && req.query.api_key !== process.env.API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const conn = await mysql.createConnection(dbConfig);

    const [rows] = await conn.execute(`
      SELECT 
        e.ele_id AS №,
        CONCAT(e.ele_sername, ' ', e.ele_name, ' ', IFNULL(e.ele_patronymic, '')) AS ФИО,
        p.psn_name AS Должность,
        e.ele_tel AS Телефон,
        e.ele_birth AS Дата_рождения,
        CASE 
          WHEN e.ess_id_FK = 1 THEN 'Базовые права'
          WHEN e.ess_id_FK = 2 THEN 'Расширенные права'
          ELSE 'Права не назначены'
        END AS Набор_прав_доступа
      FROM Employees e
      JOIN Positions p ON e.psn_id_FK = p.psn_id
      ORDER BY e.ele_id
    `);

    await conn.end();
    res.json(rows);
  } catch (err) {
    console.error("Ошибка в /get-employees:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});


// ===============================
// 👤 GET /get-patient-full — получение полных данных пациента по ФИО
// ===============================
app.get("/get-patient-full", async (req, res) => {
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
      SELECT * FROM Patients 
      WHERE ptt_sername = ? 
        AND ptt_name = ?
        AND (ptt_patronymic = ? OR ? IS NULL OR ptt_patronymic IS NULL)
      LIMIT 1
      `,
      [lastname, firstname, patronymic || null, patronymic || null]
    );

    await conn.end();
    
    if (rows.length === 0) {
      return res.status(404).json({ error: "Пациент не найден" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Ошибка в /get-patient-full:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});

// ===============================
// ✏️ PUT /update-patient — обновление данных пациента
// ===============================
app.put("/update-patient", async (req, res) => {
  const data = req.body;
  const conn = await mysql.createConnection(dbConfig);

  try {
    await conn.beginTransaction();

    // Преобразуем пол для БД
    let genderDB = "Не указано";
    if (data.gender === "male") genderDB = "Мужской";
    if (data.gender === "female") genderDB = "Женский";

    // Обновляем данные пациента
    await conn.execute(
      `
      UPDATE Patients SET
        ptt_sername = ?,
        ptt_name = ?,
        ptt_patronymic = ?,
        ptt_birth = ?,
        ptt_gender = ?,
        ptt_tel = ?,
        ptt_address = ?,
        ptt_email = ?,
        ptt_policyOMS = ?,
        ptt_snils = ?,
        ptt_passport_series = ?,
        ptt_passport_number = ?,
        ptt_date_of_issue = ?,
        ptt_disability = ?,
        ptt_allergy = ?,
        ptt_diseases = ?,
        ptt_complaints = ?
      WHERE ptt_id = ?
      `,
      [
        data.lastname,
        data.firstname,
        data.patronymic || null,
        data.birthdate || null,
        genderDB,
        data.phone || null,
        data.address || null,
        data.email || null,
        data.oms || null,
        data.snils || null,
        data.pass_series || null,
        data.pass_number || null,
        data.pass_issued || null,
        data.disability || null,
        data.allergies || null,
        data.comorbid || null,
        data.complaints || null,
        data.patient_id
      ]
    );

    await conn.commit();
    res.status(200).json({ status: "success", message: "Данные пациента обновлены" });
  } catch (err) {
    await conn.rollback();
    console.error("Ошибка при обновлении пациента:", err);
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
