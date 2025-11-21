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
  "http://systemdental.tilda.ws",
  "https://project17567096.tilda.ws",
  "http://project17567096.tilda.ws", 
  "http://systemdental.tilda.ws",
  "https://systemdental.tilda.ws",
  "https://tilda.ws"
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
// 🦷 GET /get-visit-info — данные по визитам конкретного пациента (ОБНОВЛЕННАЯ ВЕРСИЯ)
// ===============================
app.get("/get-visit-info", async (req, res) => {
  const { lastname, firstname, patronymic, api_key } = req.query;

  console.log('=== GET-VISIT-INFO ЗАПРОС ===');
  console.log('Параметры:', { lastname, firstname, patronymic });

  if (process.env.API_KEY && api_key !== process.env.API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const conn = await mysql.createConnection(dbConfig);

  try {
    const [rows] = await conn.execute(
      `
      SELECT 
        vst.vst_id,
        CONCAT(ptt.ptt_sername, ' ', ptt.ptt_name, ' ', IFNULL(ptt.ptt_patronymic, '')) AS ФИО_пациента,
        vst.vst_date AS Дата_визита,
        vst.vst_timestrart AS Начало_визита,
        vst.vst_timeend AS Конец_визита,
        CONCAT(emp.ele_sername, ' ', emp.ele_name, ' ', IFNULL(emp.ele_patronymic, '')) AS ФИО_врача,
        emp.ele_id,
        ds.dse_id,
        ds.dse_name AS Наименование_услуги,
        vds.vds_quantity AS Количество_услуг,
        ds.dse_price AS Цена_услуги,
        vds.vds_total_amount AS Сумма_за_услугу,
        vst.vst_discount AS Скидка_на_визит,
        vst.vst_final_sumservice AS Итоговая_сумма_визита,
        COALESCE(pv.pvt_payment, 0) AS Итоговая_сумма_оплаты_визита,
        COALESCE(pm.pmd_name, 'не оплачено') AS Способ_оплаты_визита,
        vst.vst_note AS Комментарий_к_визиту,
        vss.vss_type AS Статус_визита,
        vte.vte_type AS Тип_визита
      FROM Visits vst
      JOIN Patients ptt ON vst.ptt_id_FK = ptt.ptt_id
      JOIN Employees emp ON vst.ele_id_FK = emp.ele_id
      JOIN Visit_Statuses vss ON vst.vss_id_FK = vss.vss_id
      JOIN Visit_Types vte ON vst.vte_id_FK = vte.vte_id
      LEFT JOIN Visit_Dental_Services vds ON vst.vst_id = vds.vst_id_FK
      LEFT JOIN Dental_Services ds ON vds.dse_id_FK = ds.dse_id
      LEFT JOIN Paymet_Visits pv ON vst.vst_id = pv.vst_id_FK
      LEFT JOIN Payment_Methods pm ON pv.pmd_id_FK = pm.pmd_id
      WHERE ptt.ptt_sername = ? 
        AND ptt.ptt_name = ?
        AND (ptt.ptt_patronymic = ? OR ? IS NULL OR ptt.ptt_patronymic IS NULL)
      ORDER BY vst.vst_date DESC, vst.vst_timestrart DESC
      `,
      [lastname, firstname, patronymic || null, patronymic || null]
    );

    console.log(`📊 Найдено записей в БД: ${rows.length}`);
    
    // Группируем для диагностики
    const visitsMap = {};
    rows.forEach(row => {
      if (!visitsMap[row.vst_id]) {
        visitsMap[row.vst_id] = {
          visitId: row.vst_id,
          date: row.Дата_визита,
          startTime: row.Начало_визита,
          endTime: row.Конец_визита,
          doctor: row.ФИО_врача,
          doctorId: row.ele_id,
          status: row.Статус_визита,
          visitType: row.Тип_визита,
          comment: row.Комментарий_к_визиту,
          discount: row.Скидка_на_визит,
          totalAmount: row.Итоговая_сумма_визита,
          paymentAmount: row.Итоговая_сумма_оплаты_визита,
          paymentMethod: row.Способ_оплаты_визита,
          services: []
        };
      }
      if (row.dse_id) {
        visitsMap[row.vst_id].services.push({
          dse_id: row.dse_id,
          name: row.Наименование_услуги,
          quantity: row.Количество_услуг || 1,
          discount: row.Скидка_на_услугу || 0,
          price: row.Цена_услуги || 0,
          total: row.Сумма_за_услугу || 0
        });
      }
    });

    console.log('📈 Группировка по визитам:');
    Object.values(visitsMap).forEach(visit => {
      console.log(`  Визит ${visit.visitId}: ${visit.services.length} услуг, оплата: ${visit.paymentAmount} (${visit.paymentMethod})`);
    });

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

    // 3️⃣ Привязка категории пациента (например, "Взрослый" = id 5)
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
// 💾 POST /save-visit — сохранение визита (ИСПРАВЛЕННАЯ ВЕРСИЯ)
// ===============================
app.post("/save-visit", async (req, res) => {
  if (process.env.API_KEY && req.query.api_key !== process.env.API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { patientId, date, startTime, endTime, doctorId, discount, services, finalAmount, visitId } = req.body;
  
  console.log('=== НАЧАЛО СОХРАНЕНИЯ ВИЗИТА ===');
  console.log('Данные:', { visitId, servicesCount: services?.length });

  const conn = await mysql.createConnection(dbConfig);

  try {
    await conn.beginTransaction();

    // ДИАГНОСТИКА: Проверим текущее состояние визита ДО изменений
    if (visitId) {
      console.log('🔍 ДИАГНОСТИКА: Проверяем текущие услуги визита...');
      const [currentServices] = await conn.execute(
        `SELECT vds_id, dse_id_FK, vds_quantity FROM Visit_Dental_Services WHERE vst_id_FK = ?`,
        [visitId]
      );
      console.log(`📊 Текущие услуги визита ${visitId}:`, currentServices);
    }

    let visitIdToUse;

    if (visitId && !isNaN(parseInt(visitId))) {
      console.log('🔧 РЕДАКТИРОВАНИЕ визита ID:', visitId);
      
      // Двойная проверка удаления
      console.log('🗑️ УДАЛЕНИЕ старых услуг...');
      const [deleteBefore] = await conn.execute(
        `SELECT COUNT(*) as count_before FROM Visit_Dental_Services WHERE vst_id_FK = ?`,
        [visitId]
      );
      console.log(`Услуг до удаления: ${deleteBefore[0].count_before}`);

      // Удаляем ВСЕ услуги
      const [deleteResult] = await conn.execute(
        `DELETE FROM Visit_Dental_Services WHERE vst_id_FK = ?`,
        [visitId]
      );
      console.log(`🗑️ Удалено записей: ${deleteResult.affectedRows}`);

      // Проверяем, что удалилось
      const [deleteAfter] = await conn.execute(
        `SELECT COUNT(*) as count_after FROM Visit_Dental_Services WHERE vst_id_FK = ?`,
        [visitId]
      );
      console.log(`Услуг после удаления: ${deleteAfter[0].count_after}`);

      // Обновляем визит
      console.log('🔄 Обновление данных визита...');
      const [updateResult] = await conn.execute(
        `UPDATE Visits SET 
          vst_date = ?, vst_timestrart = ?, vst_timeend = ?, 
          ele_id_FK = ?, vst_discount = ?, vst_final_sumservice = ?
         WHERE vst_id = ?`,
        [date, startTime, endTime, doctorId, discount || 0, finalAmount || 0, visitId]
      );
      
      visitIdToUse = visitId;
      console.log('✅ Визит обновлен');

    } else {
      console.log('🆕 СОЗДАНИЕ нового визита');
      const [visitResult] = await conn.execute(
        `INSERT INTO Visits (
          ptt_id_FK, ele_id_FK, vst_date, vst_timestrart, vst_timeend,
          vte_id_FK, vss_id_FK, vst_discount, vst_final_sumservice
        ) VALUES (?, ?, ?, ?, ?, 1, 2, ?, ?)`,
        [patientId, doctorId, date, startTime, endTime, discount || 0, finalAmount || 0]
      );
      visitIdToUse = visitResult.insertId;
      console.log('✅ Создан визит ID:', visitIdToUse);
    }

    // Добавляем услуги
    console.log('📦 Добавление услуг:', services.length);
    for (const service of services) {
      console.log(`➕ Услуга: ${service.serviceId}, количество: ${service.quantity}`);
      
      const [serviceResult] = await conn.execute(
        `INSERT INTO Visit_Dental_Services (
          vst_id_FK, dse_id_FK, vds_quantity, vds_discount, vds_total_amount
        ) VALUES (?, ?, ?, 0, ?)`,
        [visitIdToUse, service.serviceId, service.quantity || 1, service.total || 0]
      );
      console.log(`✅ Добавлена услуга ID: ${serviceResult.insertId}`);
    }

    // ФИНАЛЬНАЯ ПРОВЕРКА
    console.log('🔍 ФИНАЛЬНАЯ ПРОВЕРКА...');
    const [finalServices] = await conn.execute(
      `SELECT vds_id, dse_id_FK, vds_quantity FROM Visit_Dental_Services WHERE vst_id_FK = ?`,
      [visitIdToUse]
    );
    console.log(`📊 Итоговые услуги визита ${visitIdToUse}:`, finalServices);

    await conn.commit();
    console.log('💾 ТРАНЗАКЦИЯ УСПЕШНА');
    
    res.status(200).json({ 
      status: "success", 
      message: "Визит успешно сохранен",
      visitId: visitIdToUse,
      finalServicesCount: finalServices.length
    });
    
  } catch (err) {
    await conn.rollback();
    console.error("❌ ОШИБКА:", err);
    res.status(500).json({ 
      error: "Ошибка сервера", 
      detail: err.message
    });
  } finally {
    await conn.end();
  }
});

// ===============================
// 💳 POST /process-payment — обработка оплаты (ОБНОВЛЕННАЯ ВЕРСИЯ)
// ===============================
app.post("/process-payment", async (req, res) => {
  const { visitId, paymentMethod, amount } = req.body;
  
  console.log('=== ОБРАБОТКА ОПЛАТЫ ===');
  console.log('Данные:', { visitId, paymentMethod, amount });

  if (process.env.API_KEY && req.query.api_key !== process.env.API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!visitId || !paymentMethod || !amount) {
    return res.status(400).json({ error: "Не все обязательные поля заполнены" });
  }

  const conn = await mysql.createConnection(dbConfig);

  try {
    await conn.beginTransaction();

    // Проверяем существование визита
    const [visitCheck] = await conn.execute(
      `SELECT vst_id FROM Visits WHERE vst_id = ?`,
      [visitId]
    );
    
    if (visitCheck.length === 0) {
      throw new Error(`Визит с ID ${visitId} не найден`);
    }

    console.log('✅ Визит найден, продолжаем оплату...');

    // Создаем квитанцию об оплате
    const [receiptResult] = await conn.execute(
      `INSERT INTO Payment_Receipts (prt_date_creation) VALUES (CURDATE())`
    );
    const receiptId = receiptResult.insertId;
    console.log('✅ Создана квитанция ID:', receiptId);

    // Добавляем запись об оплате
    const [paymentResult] = await conn.execute(
      `INSERT INTO Paymet_Visits (pvt_payment, pmd_id_FK, vst_id_FK) VALUES (?, ?, ?)`,
      [amount, paymentMethod, visitId]
    );
    console.log('✅ Добавлена запись об оплате ID:', paymentResult.insertId);

    // Обновляем визит - добавляем ссылку на квитанцию
    const [updateResult] = await conn.execute(
      `UPDATE Visits SET prt_id_FK = ? WHERE vst_id = ?`,
      [receiptId, visitId]
    );
    console.log('✅ Визит обновлен, affected rows:', updateResult.affectedRows);

    await conn.commit();
    console.log('💾 ОПЛАТА УСПЕШНО ОБРАБОТАНА');
    
    res.status(200).json({ 
      status: "success", 
      message: "Оплата успешно обработана",
      receiptId: receiptId,
      paymentId: paymentResult.insertId
    });
    
  } catch (err) {
    await conn.rollback();
    console.error("❌ ОШИБКА ОПЛАТЫ:", err);
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


// 🧹 POST /cleanup-duplicates — очистка дублирующихся услуг
app.post("/cleanup-duplicates", async (req, res) => {
  if (process.env.API_KEY && req.query.api_key !== process.env.API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { visitId } = req.body;
  const conn = await mysql.createConnection(dbConfig);

  try {
    await conn.beginTransaction();

    console.log('🧹 ОЧИСТКА ДУБЛИКАТОВ для визита:', visitId);

    // Находим дубликаты
    const [duplicates] = await conn.execute(
      `SELECT vds_id, dse_id_FK, vds_quantity, COUNT(*) as count
       FROM Visit_Dental_Services 
       WHERE vst_id_FK = ? 
       GROUP BY dse_id_FK, vds_quantity 
       HAVING COUNT(*) > 1`,
      [visitId]
    );

    console.log('Найдено дубликатов:', duplicates.length);

    let totalDeleted = 0;

    if (duplicates.length > 0) {
      // Оставляем только первую запись для каждой комбинации услуга+количество
      for (const dup of duplicates) {
        const [toDelete] = await conn.execute(
          `DELETE FROM Visit_Dental_Services 
           WHERE vst_id_FK = ? AND dse_id_FK = ? AND vds_quantity = ?
           AND vds_id != (
             SELECT min_id FROM (
               SELECT MIN(vds_id) as min_id 
               FROM Visit_Dental_Services 
               WHERE vst_id_FK = ? AND dse_id_FK = ? AND vds_quantity = ?
             ) as temp
           )`,
          [visitId, dup.dse_id_FK, dup.vds_quantity, visitId, dup.dse_id_FK, dup.vds_quantity]
        );
        console.log(`Удалено дубликатов для услуги ${dup.dse_id_FK}: ${toDelete.affectedRows}`);
        totalDeleted += toDelete.affectedRows;
      }
    }

    await conn.commit();

    // Проверяем результат
    const [finalServices] = await conn.execute(
      `SELECT vds_id, dse_id_FK, vds_quantity FROM Visit_Dental_Services WHERE vst_id_FK = ?`,
      [visitId]
    );

    console.log(`Осталось услуг после очистки: ${finalServices.length}`);

    res.status(200).json({
      status: "success",
      message: "Дубликаты очищены",
      deletedCount: totalDeleted,
      remainingServices: finalServices.length,
      services: finalServices
    });

  } catch (err) {
    await conn.rollback();
    console.error("Ошибка очистки дубликатов:", err);
    res.status(500).json({ 
      error: "Ошибка очистки дубликатов", 
      detail: err.message 
    });
  } finally {
    await conn.end();
  }
});





// ===============================
// 📦 GET /get-warehouse-receipts — получение поступлений на склад
// ===============================
app.get("/get-warehouse-receipts", async (req, res) => {
  try {
    if (process.env.API_KEY && req.query.api_key !== process.env.API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const conn = await mysql.createConnection(dbConfig);

    const [rows] = await conn.execute(`
      SELECT 
        s.Sup_id AS receipt_id,
        s.Sup_date AS receipt_date,
        sup.Short_name AS supplier_name,
        sup.Full_name AS supplier_full_name,
        COUNT(DISTINCT s.Unit_id) AS positions_count,
        SUM(s.Unit_amount) AS total_quantity,
        CASE 
          WHEN s.Sup_date > CURDATE() THEN 'coming'
          WHEN s.Sup_date = CURDATE() THEN 'new' 
          ELSE 'available'
        END AS status_type
      FROM ERP_Supplies s
      JOIN ERP_Supplier sup ON s.Supplier_id = sup.Supplier_id
      GROUP BY s.Sup_id, s.Sup_date, sup.Short_name, sup.Full_name
      ORDER BY s.Sup_date DESC
      LIMIT 10
    `);

    await conn.end();
    
    // Преобразуем данные для фронтенда
    const formattedData = rows.map(row => ({
      id: row.receipt_id,
      number: `Поступление №${String(row.receipt_id).padStart(3, '0')}`,
      date: new Date(row.receipt_date).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }),
      supplier: row.supplier_name,
      positions: row.positions_count,
      status: row.status_type,
      status_text: getStatusText(row.status_type)
    }));

    res.json(formattedData);
  } catch (err) {
    console.error("Ошибка в /get-warehouse-receipts:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});

// ===============================
// 📋 GET /get-receipt-details — детали конкретного поступления
// ===============================
app.get("/get-receipt-details", async (req, res) => {
  try {
    const { receipt_id, api_key } = req.query;

    if (process.env.API_KEY && api_key !== process.env.API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!receipt_id) {
      return res.status(400).json({ error: "Не указан ID поступления" });
    }

    const conn = await mysql.createConnection(dbConfig);

    const [rows] = await conn.execute(`
      SELECT 
        s.Sup_id,
        s.Sup_date,
        sup.Short_name AS supplier_name,
        sup.Full_name AS supplier_full_name,
        u.Name AS product_name,
        s.Unit_amount AS quantity,
        u.Specs AS specifications,
        u.Status AS stock_status
      FROM ERP_Supplies s
      JOIN ERP_Supplier sup ON s.Supplier_id = sup.Supplier_id
      JOIN ERP_Unit_In_Storage u ON s.Unit_id = u.Unit_id
      WHERE s.Sup_id = ?
      ORDER BY u.Name
    `, [receipt_id]);

    await conn.end();

    if (rows.length === 0) {
      return res.status(404).json({ error: "Поступление не найдено" });
    }

    // Форматируем данные
    const receiptDetails = {
      receipt_id: rows[0].Sup_id,
      receipt_date: new Date(rows[0].Sup_date).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }),
      supplier: rows[0].supplier_name,
      supplier_full: rows[0].supplier_full_name,
      items: rows.map(row => ({
        name: row.product_name,
        quantity: row.quantity,
        specs: row.specifications,
        status: row.stock_status
      }))
    };

    res.json(receiptDetails);
  } catch (err) {
    console.error("Ошибка в /get-receipt-details:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});

// Вспомогательная функция для получения текста статуса
function getStatusText(statusType) {
  const statusMap = {
    'coming': 'Ожидается',
    'new': 'Оформлено', 
    'available': 'Завершено'
  };
  return statusMap[statusType] || 'Оформлено';
}


// ===============================
// 📋 GET /get-receipt-for-order — детали поступления для создания заказа
// ===============================
app.get("/get-receipt-for-order", async (req, res) => {
  try {
    const { receipt_id, api_key } = req.query;

    if (process.env.API_KEY && api_key !== process.env.API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!receipt_id) {
      return res.status(400).json({ error: "Не указан ID поступления" });
    }

    const conn = await mysql.createConnection(dbConfig);

    const [rows] = await conn.execute(`
      SELECT 
        s.Sup_id as receipt_id,
        s.Sup_date as receipt_date,
        sup.Short_name AS supplier_name,
        sup.Full_name AS supplier_full_name,
        sup.Supplier_id as supplier_id,
        u.Name AS product_name,
        u.Unit_id as product_id,
        s.Unit_amount AS quantity,
        u.Specs AS specifications,
        u.Status AS stock_status
      FROM ERP_Supplies s
      JOIN ERP_Supplier sup ON s.Supplier_id = sup.Supplier_id
      JOIN ERP_Unit_In_Storage u ON s.Unit_id = u.Unit_id
      WHERE s.Sup_id = ?
      ORDER BY u.Name
    `, [receipt_id]);

    await conn.end();

    if (rows.length === 0) {
      return res.status(404).json({ error: "Поступление не найдено" });
    }

    // Форматируем данные для создания заказа
    const receiptForOrder = {
      receipt_id: rows[0].receipt_id,
      receipt_date: new Date(rows[0].receipt_date).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }),
      receipt_number: `Поступление №${String(rows[0].receipt_id).padStart(3, '0')}`,
      supplier: rows[0].supplier_name,
      supplier_full: rows[0].supplier_full_name,
      supplier_id: rows[0].supplier_id,
      items: rows.map(row => ({
        product_id: row.product_id,
        name: row.product_name,
        quantity: row.quantity,
        specs: row.specifications,
        status: row.stock_status
      }))
    };

    res.json(receiptForOrder);
  } catch (err) {
    console.error("Ошибка в /get-receipt-for-order:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});



// ===============================
// 💾 POST /save-supplier-order — сохранение заказа поставщику
// ===============================
app.post("/save-supplier-order", async (req, res) => {
  try {
    const { api_key } = req.query;
    const orderData = req.body;

    if (process.env.API_KEY && api_key !== process.env.API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!orderData) {
      return res.status(400).json({ error: "Нет данных для сохранения" });
    }

    const conn = await mysql.createConnection(dbConfig);

    await conn.beginTransaction();

    try {
      // 1. Сохраняем заказ в таблицу ERP_Orders
      const [orderResult] = await conn.execute(
        `INSERT INTO ERP_Orders (Ord_date, Status, Supplier_id, Delivery_date, Ship_date) 
         VALUES (NOW(), ?, ?, ?, ?)`,
        [
          orderData.status === 'draft' ? 'Черновик' : 'Новый',
          orderData.supplierId,
          orderData.desiredDate,
          orderData.actualDate || null
        ]
      );

      const orderId = orderResult.insertId;

      // 2. Сохраняем товары заказа
      for (const product of orderData.products) {
        // Сначала проверяем существует ли товар в Unit_To_Ord
        const [existingProduct] = await conn.execute(
          `SELECT Unit_to_ord_id FROM ERP_Unit_To_Ord WHERE Name = ?`,
          [product.name]
        );

        let productId;
        if (existingProduct.length > 0) {
          productId = existingProduct[0].Unit_to_ord_id;
          // Обновляем существующий товар
          await conn.execute(
            `UPDATE ERP_Unit_To_Ord SET Price = ?, Amount = ? WHERE Unit_to_ord_id = ?`,
            [product.price, product.quantity, productId]
          );
        } else {
          // Создаем новый товар
          const [productResult] = await conn.execute(
            `INSERT INTO ERP_Unit_To_Ord (Name, Price, Amount) VALUES (?, ?, ?)`,
            [product.name, product.price, product.quantity]
          );
          productId = productResult.insertId;
        }

        // Связываем товар с заказом (в реальной БД может потребоваться отдельная таблица связи)
        // Для примера просто обновляем Unit_to_ord_id в заказе (в реальности нужно создать таблицу Order_Items)
      }

      // 3. Сохраняем информацию о курсах валют (если нужно)
      const exchangeRatesJSON = JSON.stringify(orderData.exchangeRates);

      await conn.commit();

      res.status(200).json({
        status: "success",
        message: "Заказ успешно сохранен",
        orderId: orderId,
        orderNumber: `ORD-${String(orderId).padStart(4, '0')}`,
        savedAt: new Date().toISOString()
      });

    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      await conn.end();
    }

  } catch (err) {
    console.error("Ошибка в /save-supplier-order:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});



// ===============================
// 💰 GET /get-revenue-last-3-months — получение выручки за последние 3 месяца (ИСПРАВЛЕННАЯ ВЕРСИЯ)
// ===============================
app.get("/get-revenue-last-3-months", async (req, res) => {
  try {
    if (process.env.API_KEY && req.query.api_key !== process.env.API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const conn = await mysql.createConnection(dbConfig);

    const [rows] = await conn.execute(`
      SELECT 
        YEAR(v.vst_date) as year,
        MONTH(v.vst_date) as month,
        SUM(COALESCE(v.vst_final_sumservice, 0)) AS revenue
      FROM Visits v
      WHERE v.vst_date >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
        AND v.vst_final_sumservice IS NOT NULL
        AND v.vst_final_sumservice > 0
      GROUP BY YEAR(v.vst_date), MONTH(v.vst_date)
      ORDER BY YEAR(v.vst_date) DESC, MONTH(v.vst_date) DESC
      LIMIT 3
    `);

    await conn.end();

    // Функция для получения русского названия месяца
    const getRussianMonthName = (month) => {
      const months = [
        'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
        'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
      ];
      return months[month - 1];
    };

    // Если данных нет, возвращаем демо-данные с русскими названиями
    if (rows.length === 0) {
      const currentDate = new Date();
      const months = [];
      
      for (let i = 0; i < 3; i++) {
        const date = new Date(currentDate);
        date.setMonth(currentDate.getMonth() - i);
        const month = date.getMonth() + 1;
        const year = date.getFullYear();
        const monthName = getRussianMonthName(month);
        
        months.push({
          name: `${monthName} ${year}`,
          revenue: 0
        });
      }
      
      return res.json({ months });
    }

    // Форматируем данные для фронтенда с русскими названиями месяцев
    const formattedData = {
      months: rows.map(row => ({
        name: `${getRussianMonthName(row.month)} ${row.year}`,
        revenue: parseFloat(row.revenue) || 0
      }))
    };

    res.json(formattedData);
  } catch (err) {
    console.error("Ошибка в /get-revenue-last-3-months:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});


// ===============================
// 📊 GET /get-visits-by-employees — получение количества приемов по сотрудникам
// ===============================
app.get("/get-visits-by-employees", async (req, res) => {
  try {
    if (process.env.API_KEY && req.query.api_key !== process.env.API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const conn = await mysql.createConnection(dbConfig);

    const [rows] = await conn.execute(`
      SELECT 
        CONCAT(e.ele_sername, ' ', e.ele_name, ' ', IFNULL(e.ele_patronymic, '')) AS employee_name,
        p.psn_name AS position,
        COUNT(v.vst_id) AS visits_count
      FROM Employees e
      JOIN Positions p ON e.psn_id_FK = p.psn_id
      LEFT JOIN Visits v ON e.ele_id = v.ele_id_FK
      WHERE p.psn_name IN ('Терапевт', 'Врач-ортодонт', 'Стоматолог-хирург', 'Стоматолог-ортопед')
        AND v.vst_date >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
      GROUP BY e.ele_id, e.ele_sername, e.ele_name, e.ele_patronymic, p.psn_name
      ORDER BY visits_count DESC
    `);

    await conn.end();

    // Форматируем данные для фронтенда
    const formattedData = {
      employees: rows.map(row => ({
        name: row.employee_name,
        position: row.position,
        visits: parseInt(row.visits_count) || 0
      }))
    };

    res.json(formattedData);
  } catch (err) {
    console.error("Ошибка в /get-visits-by-employees:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});


// ===============================
// 📦 GET /get-warehouse-products — получение списка товаров для номенклатуры
// ===============================
app.get("/get-warehouse-products", async (req, res) => {
  try {
    if (process.env.API_KEY && req.query.api_key !== process.env.API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const conn = await mysql.createConnection(dbConfig);

    const [rows] = await conn.execute(`
      SELECT 
        u.Unit_id as id,
        u.Name as name,
        u.Specs as specifications,
        COALESCE(uto.Price, 0) as price
      FROM ERP_Unit_In_Storage u
      LEFT JOIN ERP_Unit_To_Ord uto ON u.Name = uto.Name
      ORDER BY u.Name
    `);

    await conn.end();
    
    // Преобразуем price в число
    const productsWithNumericPrice = rows.map(product => ({
      ...product,
      price: parseFloat(product.price) || 0
    }));
    
    res.json(productsWithNumericPrice);
  } catch (err) {
    console.error("Ошибка в /get-warehouse-products:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});

// ===============================
// 🚀 Запуск сервера
// ===============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ API listening on port ${PORT}`));
