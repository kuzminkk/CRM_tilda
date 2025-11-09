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
    let query = `
      SELECT * FROM Patients 
      WHERE ptt_sername = ? 
        AND ptt_name = ?
    `;
    let params = [lastname, firstname];

    if (patronymic) {
      query += ` AND ptt_patronymic = ?`;
      params.push(patronymic);
    } else {
      query += ` AND (ptt_patronymic IS NULL OR ptt_patronymic = '')`;
    }

    query += ` LIMIT 1`;

    const [rows] = await conn.execute(query, params);

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
// 🦷 GET /get-visit-info — данные по визитам конкретного пациента (ОБНОВЛЕННЫЙ)
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
        vst.vst_id,
        CONCAT(ptt.ptt_sername, ' ', ptt.ptt_name, ' ', IFNULL(ptt.ptt_patronymic, '')) AS ФИО_пациента,
        vss.vss_type AS Статус_визита,
        vst.vst_date AS Дата_визита,
        vst.vst_timestrart AS Начало_визита,
        vst.vst_timeend AS Конец_визита,
        CONCAT(emp.ele_sername, ' ', emp.ele_name, ' ', IFNULL(emp.ele_patronymic, '')) AS ФИО_врача,
        emp.ele_id,
        vte.vte_type AS Тип_визита,
        vst.vst_note AS Комментарий_к_визиту,
        ds.dse_id,
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
      LEFT JOIN Paymet_Visits pv ON vst.vst_id = pv.vst_id_FK
      LEFT JOIN Payment_Methods pm ON pv.pmd_id_FK = pm.pmd_id
      WHERE ptt.ptt_sername = ? 
        AND ptt.ptt_name = ?
        AND (ptt.ptt_patronymic = ? OR ? IS NULL OR ptt.ptt_patronymic IS NULL)
      ORDER BY vst.vst_date DESC, vst.vst_timestrart DESC
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
// 🦷 GET /get-dental-services — получение списка стоматологических услуг
// ===============================
app.get("/get-dental-services", async (req, res) => {
  try {
    if (process.env.API_KEY && req.query.api_key !== process.env.API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const conn = await mysql.createConnection(dbConfig);

    const [rows] = await conn.execute(`
      SELECT 
        dse_id,
        dse_name,
        dse_price,
        dse_warranty,
        dse_description,
        scy_id_FK
      FROM Dental_Services
      ORDER BY dse_name
    `);

    await conn.end();
    res.json(rows);
  } catch (err) {
    console.error("Ошибка в /get-dental-services:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});

// ===============================
// 👨‍⚕️ GET /get-doctors — получение списка врачей
// ===============================
app.get("/get-doctors", async (req, res) => {
  try {
    if (process.env.API_KEY && req.query.api_key !== process.env.API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const conn = await mysql.createConnection(dbConfig);

    const [rows] = await conn.execute(`
      SELECT 
        ele_id,
        CONCAT(ele_sername, ' ', ele_name, ' ', IFNULL(ele_patronymic, '')) AS ФИО,
        p.psn_name AS Должность
      FROM Employees e
      JOIN Positions p ON e.psn_id_FK = p.psn_id
      WHERE p.psn_name IN ('Терапевт', 'Врач-ортодонт', 'Стоматолог-хирург', 'Стоматолог-ортопед')
      ORDER BY ele_sername, ele_name
    `);

    await conn.end();
    res.json(rows);
  } catch (err) {
    console.error("Ошибка в /get-doctors:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});

// ===============================
// 💾 POST /save-visit — сохранение визита (ПОЛНОСТЬЮ ИСПРАВЛЕННЫЙ)
// ===============================
app.post("/save-visit", async (req, res) => {
  const { patientId, date, startTime, endTime, doctorId, discount, services, finalAmount, visitId } = req.body;
  
  console.log('Получены данные для сохранения визита:', {
    patientId, date, startTime, endTime, doctorId, discount, 
    servicesCount: services?.length, finalAmount, visitId
  });

  if (process.env.API_KEY && req.query.api_key !== process.env.API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!patientId || !date || !doctorId || !services || services.length === 0) {
    return res.status(400).json({ 
      error: "Не все обязательные поля заполнены",
      details: { patientId: !!patientId, date: !!date, doctorId: !!doctorId, services: services?.length }
    });
  }

  const conn = await mysql.createConnection(dbConfig);

  try {
    await conn.beginTransaction();

    let visitIdToUse;

    if (visitId) {
      console.log('Обновление существующего визита с ID:', visitId);
      // Обновление существующего визита
      const [updateResult] = await conn.execute(
        `UPDATE Visits SET 
          vst_date = ?, vst_timestrart = ?, vst_timeend = ?, 
          ele_id_FK = ?, vst_discount = ?, vst_final_sumservice = ?
         WHERE vst_id = ?`,
        [date, startTime, endTime, doctorId, discount, finalAmount, visitId]
      );
      visitIdToUse = visitId;
      console.log('Визит обновлен, affected rows:', updateResult.affectedRows);

      // Удаляем старые услуги
      const [deleteResult] = await conn.execute(`DELETE FROM Visit_Dental_Services WHERE vst_id_FK = ?`, [visitId]);
      console.log('Удалено старых услуг:', deleteResult.affectedRows);
    } else {
      console.log('Создание нового визита');
      // Создание нового визита
      const [visitResult] = await conn.execute(
        `INSERT INTO Visits (
          ptt_id_FK, ele_id_FK, vst_date, vst_timestrart, vst_timeend,
          vte_id_FK, vss_id_FK, vst_discount, vst_final_sumservice
        ) VALUES (?, ?, ?, ?, ?, 1, 2, ?, ?)`,
        [patientId, doctorId, date, startTime, endTime, discount, finalAmount]
      );
      visitIdToUse = visitResult.insertId;
      console.log('Создан новый визит с ID:', visitIdToUse, 'Result:', visitResult);
    }

    console.log('ID визита для услуг:', visitIdToUse);

    // Проверяем, что visitIdToUse корректен
    if (!visitIdToUse) {
      throw new Error('Не удалось получить ID визита');
    }

    // Добавляем услуги
    console.log('Добавляем услуги:', services);
    for (const service of services) {
      console.log('Добавляем услугу:', service);
      const [serviceResult] = await conn.execute(
        `INSERT INTO Visit_Dental_Services (
          vst_id_FK, dse_id_FK, vds_quantity, vds_discount, vds_total_amount
        ) VALUES (?, ?, ?, 0, ?)`,
        [visitIdToUse, service.serviceId, service.quantity, service.total]
      );
      console.log('Услуга добавлена, ID:', serviceResult.insertId);
    }

    await conn.commit();
    console.log('Транзакция завершена успешно');
    
    res.status(200).json({ 
      status: "success", 
      message: "Визит успешно сохранен",
      visitId: visitIdToUse
    });
    
  } catch (err) {
    await conn.rollback();
    console.error("Ошибка при сохранении визита:", err);
    console.error("Детали ошибки:", {
      patientId, date, doctorId, visitId, 
      visitIdToUse, servicesCount: services?.length
    });
    res.status(500).json({ 
      error: "Ошибка сервера при сохранении визита", 
      detail: err.message,
      sql: err.sql,
      code: err.code
    });
  } finally {
    await conn.end();
  }
});

// ===============================
// 💳 POST /process-payment — обработка оплаты
// ===============================
app.post("/process-payment", async (req, res) => {
  const { visitId, paymentMethod, amount } = req.body;
  
  if (process.env.API_KEY && req.query.api_key !== process.env.API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!visitId || !paymentMethod || !amount) {
    return res.status(400).json({ error: "Не все обязательные поля заполнены" });
  }

  const conn = await mysql.createConnection(dbConfig);

  try {
    await conn.beginTransaction();

    // Создаем квитанцию об оплате
    const [receiptResult] = await conn.execute(
      `INSERT INTO Payment_Receipts (prt_date_creation) VALUES (CURDATE())`
    );
    const receiptId = receiptResult.insertId;

    // Добавляем запись об оплате
    await conn.execute(
      `INSERT INTO Paymet_Visits (pvt_payment, pmd_id_FK, vst_id_FK) VALUES (?, ?, ?)`,
      [amount, paymentMethod, visitId]
    );

    // Обновляем визит - добавляем ссылку на квитанцию и сумму оплаты
    await conn.execute(
      `UPDATE Visits SET prt_id_FK = ?, vst_payment_amount = ? WHERE vst_id = ?`,
      [receiptId, amount, visitId]
    );

    await conn.commit();
    
    res.status(200).json({ 
      status: "success", 
      message: "Оплата успешно обработана",
      receiptId: receiptId
    });
    
  } catch (err) {
    await conn.rollback();
    console.error("Ошибка при обработке оплаты:", err);
    res.status(500).json({ 
      error: "Ошибка сервера при обработке оплаты", 
      detail: err.message 
    });
  } finally {
    await conn.end();
  }
});



// ===============================
// 👤 GET /get-patient-id — получение ID пациента по ФИО
// ===============================
app.get("/get-patient-id", async (req, res) => {
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
      SELECT ptt_id as patient_id FROM Patients 
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
    console.error("Ошибка в /get-patient-id:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});



// В функции saveVisit добавьте console.log для отладки:
const saveVisit = async () => {
  const visitData = {
    patientId: currentPatientId,
    date: document.getElementById('visit-date').value,
    startTime: document.getElementById('visit-time-start').value,
    endTime: document.getElementById('visit-time-end').value,
    discount: parseFloat(document.getElementById('visit-discount').value) || 0,
    doctorId: document.getElementById('visit-doctor').value,
    services: [],
    finalAmount: parseFormattedCurrency(visitTotal.textContent)
  };

  if (currentVisit && currentVisit.id) {
    visitData.visitId = currentVisit.id;
  }

  document.querySelectorAll('.service-row').forEach(row => {
    const select = row.querySelector('.service-select');
    const quantityInput = row.querySelector('.service-quantity-input');
    const priceDisplay = row.querySelector('.service-price-display');
    
    if (select.value) {
      visitData.services.push({
        serviceId: select.value,
        quantity: parseInt(quantityInput.value) || 1,
        price: parseFormattedCurrency(priceDisplay.textContent),
        total: parseFormattedCurrency(row.querySelector('.service-total-display').textContent)
      });
    }
  });

  console.log('Данные для сохранения:', visitData); // Добавьте эту строку для отладки

  if (visitData.services.length === 0) {
    showNotification('Добавьте хотя бы одну услугу', 'error');
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/save-visit?api_key=${API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(visitData)
    });

    console.log('Статус ответа:', response.status); // Добавьте эту строку

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Текст ошибки:', errorText); // Добавьте эту строку
      throw new Error('Ошибка сохранения визита: ' + errorText);
    }

    const result = await response.json();
    console.log('Результат сохранения:', result); // Добавьте эту строку
    
    showNotification('Визит успешно сохранен', 'success');
    closeModals();
    await loadPatientVisits(lastname, firstname, patronymic);
    
  } catch (err) {
    console.error('Ошибка сохранения визита:', err);
    showNotification('Ошибка сохранения визита: ' + err.message, 'error');
  }
};




// ===============================
// 🚀 Запуск сервера
// ===============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ API listening on port ${PORT}`));
