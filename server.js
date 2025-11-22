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
// 💾 POST /save-visit — сохранение визита с поддержкой товаров (ОБНОВЛЕННАЯ ВЕРСИЯ)
// ===============================
app.post("/save-visit", async (req, res) => {
  if (process.env.API_KEY && req.query.api_key !== process.env.API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { patientId, date, startTime, endTime, doctorId, discount, services, products, finalAmount, visitId } = req.body;
  
  console.log('=== НАЧАЛО СОХРАНЕНИЯ ВИЗИТА ===');
  console.log('Данные:', { 
    visitId, 
    servicesCount: services?.length,
    productsCount: products?.length 
  });

  const conn = await mysql.createConnection(dbConfig);

  try {
    await conn.beginTransaction();

    // ДИАГНОСТИКА: Проверим текущее состояние визита ДО изменений
    if (visitId) {
      console.log('🔍 ДИАГНОСТИКА: Проверяем текущие данные визита...');
      const [currentServices] = await conn.execute(
        `SELECT vds_id, dse_id_FK, vds_quantity FROM Visit_Dental_Services WHERE vst_id_FK = ?`,
        [visitId]
      );
      console.log(`📊 Текущие услуги визита ${visitId}:`, currentServices);

      // Проверяем текущие товары визита (если таблица существует)
      try {
        const [currentProducts] = await conn.execute(
          `SELECT id, product_id, quantity FROM Visit_Products WHERE visit_id = ?`,
          [visitId]
        );
        console.log(`📦 Текущие товары визита ${visitId}:`, currentProducts);
      } catch (err) {
        console.log('ℹ️ Таблица Visit_Products еще не создана, пропускаем проверку товаров');
      }
    }

    let visitIdToUse;

    if (visitId && !isNaN(parseInt(visitId))) {
      console.log('🔧 РЕДАКТИРОВАНИЕ визита ID:', visitId);
      
      // УДАЛЕНИЕ старых услуг
      console.log('🗑️ УДАЛЕНИЕ старых услуг...');
      const [deleteBefore] = await conn.execute(
        `SELECT COUNT(*) as count_before FROM Visit_Dental_Services WHERE vst_id_FK = ?`,
        [visitId]
      );
      console.log(`Услуг до удаления: ${deleteBefore[0].count_before}`);

      const [deleteResult] = await conn.execute(
        `DELETE FROM Visit_Dental_Services WHERE vst_id_FK = ?`,
        [visitId]
      );
      console.log(`🗑️ Удалено услуг: ${deleteResult.affectedRows}`);

      // УДАЛЕНИЕ старых товаров (если таблица существует)
      let deletedProductsCount = 0;
      try {
        // Сначала получаем старые товары для восстановления остатков
        const [oldProducts] = await conn.execute(
          `SELECT product_id, quantity FROM Visit_Products WHERE visit_id = ?`,
          [visitId]
        );
        
        // Восстанавливаем остатки на складе для старых товаров
        for (const oldProduct of oldProducts) {
          await conn.execute(
            `UPDATE ERP_Unit_In_Storage SET Amount = Amount + ? WHERE Unit_id = ?`,
            [oldProduct.quantity, oldProduct.product_id]
          );
          console.log(`↩️ Восстановлен товар ${oldProduct.product_id}: +${oldProduct.quantity} шт.`);
        }

        // Удаляем старые товары визита
        const [deleteProductsResult] = await conn.execute(
          `DELETE FROM Visit_Products WHERE visit_id = ?`,
          [visitId]
        );
        deletedProductsCount = deleteProductsResult.affectedRows;
        console.log(`🗑️ Удалено товаров: ${deletedProductsCount}`);
      } catch (err) {
        console.log('ℹ️ Таблица Visit_Products еще не создана, пропускаем удаление товаров');
      }

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

    // ДОБАВЛЕНИЕ УСЛУГ
    console.log('📦 Добавление услуг:', services?.length || 0);
    if (services && services.length > 0) {
      for (const service of services) {
        console.log(`➕ Услуга: ${service.serviceId || service.id}, количество: ${service.quantity}`);
        
        const serviceId = service.serviceId || service.id;
        const serviceQuantity = service.quantity || 1;
        const serviceTotal = service.total || (service.price * serviceQuantity);
        
        const [serviceResult] = await conn.execute(
          `INSERT INTO Visit_Dental_Services (
            vst_id_FK, dse_id_FK, vds_quantity, vds_discount, vds_total_amount
          ) VALUES (?, ?, ?, 0, ?)`,
          [visitIdToUse, serviceId, serviceQuantity, serviceTotal]
        );
        console.log(`✅ Добавлена услуга ID: ${serviceResult.insertId}`);
      }
    } else {
      console.log('ℹ️ Услуги не указаны');
    }

    // ДОБАВЛЕНИЕ ТОВАРОВ
    console.log('📦 Добавление товаров:', products?.length || 0);
    if (products && products.length > 0) {
      try {
        for (const product of products) {
          console.log(`➕ Товар: ${product.id}, количество: ${product.quantity}`);
          
          // Проверяем доступное количество
          const [productCheck] = await conn.execute(
            `SELECT Amount, Name FROM ERP_Unit_In_Storage WHERE Unit_id = ?`,
            [product.id]
          );
          
          if (productCheck.length === 0) {
            throw new Error(`Товар с ID ${product.id} не найден`);
          }
          
          const availableQuantity = productCheck[0].Amount;
          const productName = productCheck[0].Name;
          
          if (availableQuantity < product.quantity) {
            throw new Error(`Недостаточно товара "${productName}". Доступно: ${availableQuantity}, требуется: ${product.quantity}`);
          }
          
          // Добавляем товар в визит
          const [productResult] = await conn.execute(
            `INSERT INTO Visit_Products (visit_id, product_id, quantity) VALUES (?, ?, ?)`,
            [visitIdToUse, product.id, product.quantity]
          );
          
          // Обновляем количество на складе
          await conn.execute(
            `UPDATE ERP_Unit_In_Storage SET Amount = Amount - ? WHERE Unit_id = ?`,
            [product.quantity, product.id]
          );
          
          console.log(`✅ Добавлен товар ID: ${productResult.insertId}, списано со склада: ${product.quantity} шт.`);
        }
      } catch (err) {
        // Если таблица Visit_Products не существует, создаем ее
        if (err.code === 'ER_NO_SUCH_TABLE') {
          console.log('📋 Создаем таблицу Visit_Products...');
          
          await conn.execute(`
            CREATE TABLE Visit_Products (
              id INT NOT NULL PRIMARY KEY AUTO_INCREMENT,
              visit_id INT NOT NULL,
              product_id INT NOT NULL,
              quantity INT NOT NULL,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (visit_id) REFERENCES Visits(vst_id),
              FOREIGN KEY (product_id) REFERENCES ERP_Unit_In_Storage(Unit_id)
            )
          `);
          console.log('✅ Таблица Visit_Products создана');
          
          // Повторяем добавление товаров после создания таблицы
          for (const product of products) {
            const [productResult] = await conn.execute(
              `INSERT INTO Visit_Products (visit_id, product_id, quantity) VALUES (?, ?, ?)`,
              [visitIdToUse, product.id, product.quantity]
            );
            
            await conn.execute(
              `UPDATE ERP_Unit_In_Storage SET Amount = Amount - ? WHERE Unit_id = ?`,
              [product.quantity, product.id]
            );
            
            console.log(`✅ Добавлен товар ID: ${productResult.insertId}`);
          }
        } else {
          throw err;
        }
      }
    } else {
      console.log('ℹ️ Товары не указаны');
    }

    // ФИНАЛЬНАЯ ПРОВЕРКА
    console.log('🔍 ФИНАЛЬНАЯ ПРОВЕРКА...');
    
    // Проверяем услуги
    const [finalServices] = await conn.execute(
      `SELECT vds_id, dse_id_FK, vds_quantity FROM Visit_Dental_Services WHERE vst_id_FK = ?`,
      [visitIdToUse]
    );
    console.log(`📊 Итоговые услуги визита ${visitIdToUse}:`, finalServices);

    // Проверяем товары
    let finalProducts = [];
    try {
      const [productsCheck] = await conn.execute(
        `SELECT id, product_id, quantity FROM Visit_Products WHERE visit_id = ?`,
        [visitIdToUse]
      );
      finalProducts = productsCheck;
      console.log(`📦 Итоговые товары визита ${visitIdToUse}:`, finalProducts);
    } catch (err) {
      console.log('ℹ️ Таблица Visit_Products не доступна для проверки');
    }

    await conn.commit();
    console.log('💾 ТРАНЗАКЦИЯ УСПЕШНА');
    
    res.status(200).json({ 
      status: "success", 
      message: "Визит успешно сохранен",
      visitId: visitIdToUse,
      finalServicesCount: finalServices.length,
      finalProductsCount: finalProducts.length
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
// 📦 GET /get-warehouse-receipts — получение поступлений на склад (ОБНОВЛЕННАЯ ВЕРСИЯ)
// ===============================
app.get("/get-warehouse-receipts", async (req, res) => {
  try {
    if (process.env.API_KEY && req.query.api_key !== process.env.API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const conn = await mysql.createConnection(dbConfig);

    // Получаем заказы с количеством товаров
    const [rows] = await conn.execute(`
      SELECT 
        o.Ord_id AS id,
        CONCAT('ORD-', LPAD(o.Ord_id, 4, '0')) AS number,
        o.Ord_date AS date,
        o.Status AS status,
        s.Short_name AS supplier,
        s.Supplier_id AS supplier_id,
        COUNT(oi.Order_item_id) AS positions_count
      FROM ERP_Orders o
      LEFT JOIN ERP_Supplier s ON o.Supplier_id = s.Supplier_id
      LEFT JOIN ERP_Order_Items oi ON o.Ord_id = oi.Ord_id
      GROUP BY o.Ord_id, o.Ord_date, o.Status, s.Short_name, s.Supplier_id
      ORDER BY o.Ord_date DESC
      LIMIT 10
    `);

    await conn.end();
    
    // Преобразуем данные для фронтенда
    const formattedData = rows.map(row => ({
      id: row.id,
      number: row.number,
      date: new Date(row.date).toLocaleDateString('ru-RU'),
      supplier: row.supplier,
      supplier_id: row.supplier_id,
      positions: row.positions_count || 1, // Минимум 1 позиция
      status: mapOrderStatus(row.status),
      status_text: getStatusText(mapOrderStatus(row.status))
    }));

    console.log('📊 Заказы для отображения:', formattedData);
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
// 💾 ОБНОВЛЕННЫЙ ЭНДПОИНТ СОХРАНЕНИЯ ЗАКАЗА С ОБНОВЛЕНИЕМ СКЛАДА
// ===============================
app.post('/save-supplier-order-fixed', async (req, res) => {
  let conn;
  
  try {
    const { receipt_id, status, supplierId, desiredDate, actualDate, products, orderNumber, totalAmount } = req.body;
    
    console.log('📦 Получены данные заказа для сохранения:', { 
      receipt_id, 
      status, 
      productsCount: products?.length 
    });
    
    if (!supplierId || !products || products.length === 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    conn = await mysql.createConnection(dbConfig);
    await conn.beginTransaction();
    
    // Получаем предыдущий статус заказа (если заказ существует)
    let previousStatus = null;
    if (receipt_id) {
      previousStatus = await getPreviousOrderStatus(receipt_id);
      console.log(`📋 Предыдущий статус заказа: ${previousStatus}, новый статус: ${status}`);
    }
    
    let orderId = receipt_id;
    
    if (receipt_id) {
      // ОБНОВЛЕНИЕ существующего заказа
      console.log('🔄 Updating existing order:', receipt_id);
      
      // Обновляем основную информацию заказа
      await conn.execute(
        `UPDATE ERP_Orders 
         SET Status = ?, Supplier_id = ?, Delivery_date = ?, Ship_date = ?
         WHERE Ord_id = ?`,
        [mapStatusToDB(status), supplierId, desiredDate, actualDate, receipt_id]
      );
      
      // Удаляем старые товары заказа
      try {
        await conn.execute(`DELETE FROM ERP_Order_Items WHERE Ord_id = ?`, [receipt_id]);
        console.log('✅ Old order items removed');
      } catch (error) {
        console.log('ℹ️ ERP_Order_Items table not available, skipping item removal');
      }
      
    } else {
      // СОЗДАНИЕ нового заказа
      console.log('🆕 Creating new order');
      
      // Получаем следующий ID
      const [maxIdRows] = await conn.execute('SELECT MAX(Ord_id) as maxId FROM ERP_Orders');
      const nextId = (maxIdRows[0].maxId || 0) + 1;
      
      // Создаем заказ
      await conn.execute(
        `INSERT INTO ERP_Orders (Ord_id, Ord_date, Status, Supplier_id, Delivery_date, Ship_date, Unit_to_ord_id)
         VALUES (?, NOW(), ?, ?, ?, ?, ?)`,
        [nextId, mapStatusToDB(status), supplierId, desiredDate, actualDate, products[0].id]
      );
      
      orderId = nextId;
      console.log('✅ New order created with ID:', nextId);
    }
    
    // Добавляем все товары в заказ
    try {
      for (const product of products) {
        console.log(`➕ Adding product: ${product.name}, quantity: ${product.quantity}, price: ${product.price}`);
        
        await conn.execute(
          `INSERT INTO ERP_Order_Items (Ord_id, Unit_to_ord_id, Quantity, Price)
           VALUES (?, ?, ?, ?)`,
          [orderId, product.id, product.quantity, product.price]
        );
      }
      console.log('✅ All products added to order items');
    } catch (error) {
      console.log('ℹ️ ERP_Order_Items table not available, saving only first product to main order');
      // Обновляем заказ с первым товаром для обратной совместимости
      await conn.execute(
        `UPDATE ERP_Orders SET Unit_to_ord_id = ? WHERE Ord_id = ?`,
        [products[0].id, orderId]
      );
    }
    
    // 🔄 ПРОВЕРЯЕМ НУЖНО ЛИ ОБНОВЛЯТЬ СКЛАД
    const currentStatus = mapStatusToDB(status);
    const isStatusChangedToDelivered = 
      (currentStatus === 'Доставлено' && previousStatus !== 'Доставлено');

    let stockUpdateResult = null;
    if (isStatusChangedToDelivered) {
      console.log('🔄 Статус изменен на "Доставлен" - обновляем склад');
      
      // Обновляем склад
      stockUpdateResult = await updateWarehouseStock({
        ...req.body,
        receipt_id: orderId
      });
      
      console.log('📊 Результат обновления склада:', stockUpdateResult);
    } else {
      console.log('ℹ️ Статус не изменился на "Доставлен" - склад не обновляется');
    }
    
    await conn.commit();
    
    console.log('✅ Order saved successfully');
    
    res.json({
      success: true,
      orderId: orderId,
      orderNumber: orderNumber || `ORD-${String(orderId).padStart(4, '0')}`,
      productsCount: products.length,
      stockUpdated: isStatusChangedToDelivered,
      stockUpdateDetails: stockUpdateResult,
      message: receipt_id ? 'Order updated successfully' : 'Order created successfully'
    });
    
  } catch (error) {
    if (conn) await conn.rollback();
    console.error('❌ Error saving order:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  } finally {
    if (conn) await conn.end();
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


// Эндпоинт для получения деталей заказа с поддержкой нескольких товаров
app.get('/get-order-details', async (req, res) => {
  let conn;
  
  try {
    const { receipt_id, api_key } = req.query;
    
    if (process.env.API_KEY && api_key !== process.env.API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    if (!receipt_id) {
      return res.status(400).json({ error: 'receipt_id is required' });
    }
    
    conn = await mysql.createConnection(dbConfig);
    
    // Получаем основную информацию о заказе
    const [orderRows] = await conn.execute(
      `SELECT o.Ord_id, o.Ord_date, o.Status, o.Supplier_id, o.Delivery_date, o.Ship_date,
              s.Short_name as supplier_name
       FROM ERP_Orders o
       LEFT JOIN ERP_Supplier s ON o.Supplier_id = s.Supplier_id
       WHERE o.Ord_id = ?`,
      [receipt_id]
    );
    
    if (orderRows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    const order = orderRows[0];
    
    // Получаем все товары заказа из новой таблицы
    const [productRows] = await conn.execute(
      `SELECT oi.Unit_to_ord_id as product_id, u.Name as product_name, 
              oi.Price as price, oi.Quantity as quantity, 'шт' as unit
       FROM ERP_Order_Items oi
       INNER JOIN ERP_Unit_To_Ord u ON oi.Unit_to_ord_id = u.Unit_to_ord_id
       WHERE oi.Ord_id = ?`,
      [receipt_id]
    );
    
    // Если нет товаров в новой таблице, получаем из старой (для обратной совместимости)
    let products = productRows;
    if (products.length === 0) {
      const [legacyProductRows] = await conn.execute(
        `SELECT u.Unit_to_ord_id as product_id, u.Name as product_name, 
                u.Price as price, u.Amount as quantity, 'шт' as unit
         FROM ERP_Unit_To_Ord u
         INNER JOIN ERP_Orders o ON o.Unit_to_ord_id = u.Unit_to_ord_id
         WHERE o.Ord_id = ?`,
        [receipt_id]
      );
      products = legacyProductRows;
    }
    
    const orderData = {
      receipt_id: order.Ord_id,
      order_date: order.Ord_date,
      status: mapOrderStatus(order.Status),
      supplier_id: order.Supplier_id,
      supplier_name: order.supplier_name,
      desired_date: order.Delivery_date,
      actual_date: order.Ship_date,
      order_number: `ORD-${String(order.Ord_id).padStart(4, '0')}`,
      products: products
    };
    
    console.log(`✅ Loaded order ${receipt_id} with ${products.length} products`);
    
    res.json(orderData);
    
  } catch (error) {
    console.error('Error fetching order details:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (conn) await conn.end();
  }
});


// Маппинг статусов для заказов
function mapOrderStatus(dbStatus) {
  const statusMap = {
    'В обработке': 'in-progress',
    'Отгружено': 'shipped',
    'Доставлено': 'delivered'
  };
  return statusMap[dbStatus] || 'new';
}

// Маппинг статусов для БД
function mapStatusToDB(status) {
  const statusMap = {
    'new': 'В обработке',
    'in-progress': 'В обработке',
    'shipped': 'Отгружено',
    'delivered': 'Доставлено',
    'cancelled': 'Отменено',
    'draft': 'Черновик'
  };
  return statusMap[status] || 'В обработке';
}

// ===============================
// 📦 GET /get-warehouse-items — получение товаров на складе
// ===============================
app.get("/get-warehouse-items", async (req, res) => {
  try {
    if (process.env.API_KEY && req.query.api_key !== process.env.API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const conn = await mysql.createConnection(dbConfig);

    const [rows] = await conn.execute(`
      SELECT 
        Unit_id as id,
        Name as name,
        Specs as specifications,
        Amount as quantity,
        Status as status
      FROM ERP_Unit_In_Storage
      ORDER BY Name
    `);

    await conn.end();
    
    // Преобразуем статусы для фронтенда
    const formattedItems = rows.map(item => {
      let statusType = 'available';
      let statusText = 'В наличии';
      
      switch(item.status) {
        case 'Требуется заказ':
          statusType = 'coming';
          statusText = 'Скоро поступление';
          break;
        case 'Новый':
          statusType = 'new';
          statusText = 'Новый';
          break;
        case 'На складе':
        default:
          statusType = 'available';
          statusText = 'В наличии';
      }
      
      return {
        ...item,
        status_type: statusType,
        status_text: statusText
      };
    });

    console.log('📊 Товары на складе:', formattedItems.length, 'шт.');
    res.json(formattedItems);
  } catch (err) {
    console.error("Ошибка в /get-warehouse-items:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});

// ===============================
// 📦 PUT /update-warehouse-quantity — обновление количества товара
// ===============================
app.put("/update-warehouse-quantity", async (req, res) => {
  try {
    if (process.env.API_KEY && req.query.api_key !== process.env.API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { item_id, new_quantity } = req.body;
    
    if (!item_id || new_quantity === undefined) {
      return res.status(400).json({ error: "Не указаны item_id или new_quantity" });
    }

    const conn = await mysql.createConnection(dbConfig);

    const [result] = await conn.execute(
      `UPDATE ERP_Unit_In_Storage SET Amount = ? WHERE Unit_id = ?`,
      [new_quantity, item_id]
    );

    await conn.end();

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Товар не найден" });
    }

    res.json({ 
      status: "success", 
      message: "Количество обновлено",
      item_id: item_id,
      new_quantity: new_quantity
    });
  } catch (err) {
    console.error("Ошибка в /update-warehouse-quantity:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});


// ===============================
// 📦 GET /get-visit-products — получение товаров использованных в визите
// ===============================
app.get("/get-visit-products", async (req, res) => {
  try {
    const { visit_id, api_key } = req.query;

    if (process.env.API_KEY && api_key !== process.env.API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!visit_id) {
      return res.status(400).json({ error: "Не указан ID визита" });
    }

    const conn = await mysql.createConnection(dbConfig);

    try {
      const [rows] = await conn.execute(`
        SELECT 
          vp.id,
          vp.product_id,
          u.Name as name,
          u.Specs as specifications,
          vp.quantity,
          u.Amount as available
        FROM Visit_Products vp
        JOIN ERP_Unit_In_Storage u ON vp.product_id = u.Unit_id
        WHERE vp.visit_id = ?
      `, [visit_id]);

      await conn.end();
      res.json(rows);
    } catch (err) {
      // Если таблица не существует, возвращаем пустой массив
      if (err.code === 'ER_NO_SUCH_TABLE') {
        await conn.end();
        res.json([]);
      } else {
        throw err;
      }
    }
  } catch (err) {
    console.error("Ошибка в /get-visit-products:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});


// ===============================
// 📦 ФУНКЦИИ ДЛЯ АВТОМАТИЧЕСКОГО ОБНОВЛЕНИЯ СКЛАДА
// ===============================

// Функция для обновления количества товаров на складе при доставке заказа
async function updateWarehouseStock(orderData) {
  let conn;
  
  try {
    console.log('🔄 Обновление склада для заказа:', orderData.receipt_id);
    
    conn = await mysql.createConnection(dbConfig);
    await conn.beginTransaction();

    // Проверяем, изменился ли статус на "Доставлен"
    if (orderData.status === 'delivered' || orderData.status === 'Доставлено') {
      console.log('✅ Статус "Доставлен" - обновляем склад');
      
      let updatedProducts = [];
      
      // Для каждого товара в заказе обновляем количество на складе
      for (const product of orderData.products) {
        console.log(`📦 Обрабатываем товар: ${product.name} (ID: ${product.id}), количество: ${product.quantity}`);
        
        // Получаем текущее количество товара на складе
        const [currentStock] = await conn.execute(
          'SELECT Unit_id, Name, Specs, Amount, Status FROM ERP_Unit_In_Storage WHERE Unit_id = ?',
          [product.id]
        );
        
        if (currentStock.length > 0) {
          const currentAmount = currentStock[0].Amount;
          const newAmount = currentAmount + product.quantity;
          
          // Обновляем количество на складе
          await conn.execute(
            'UPDATE ERP_Unit_In_Storage SET Amount = ?, Status = ? WHERE Unit_id = ?',
            [newAmount, 'На складе', product.id]
          );
          
          console.log(`✅ Товар ID ${product.id}: ${currentAmount} + ${product.quantity} = ${newAmount}`);
          updatedProducts.push({
            id: product.id,
            name: product.name,
            oldAmount: currentAmount,
            newAmount: newAmount,
            added: product.quantity
          });
        } else {
          // Если товара нет на складе, создаем новую запись
          await conn.execute(
            'INSERT INTO ERP_Unit_In_Storage (Unit_id, Name, Specs, Amount, Status) VALUES (?, ?, ?, ?, ?)',
            [product.id, product.name, product.specifications || '', product.quantity, 'На складе']
          );
          
          console.log(`✅ Создана новая позиция на складе: ${product.name}`);
          updatedProducts.push({
            id: product.id,
            name: product.name,
            oldAmount: 0,
            newAmount: product.quantity,
            added: product.quantity
          });
        }
      }
      
      await conn.commit();
      console.log('✅ Склад успешно обновлен');
      
      return {
        success: true,
        updatedProducts: updatedProducts
      };
    }
    
    console.log('ℹ️ Статус не "Доставлен" - склад не обновляется');
    return {
      success: false,
      reason: 'Статус не "Доставлен"'
    };
    
  } catch (error) {
    if (conn) await conn.rollback();
    console.error('❌ Ошибка обновления склада:', error);
    throw error;
  } finally {
    if (conn) await conn.end();
  }
}

// Функция для получения предыдущего статуса заказа
async function getPreviousOrderStatus(orderId) {
  let conn;
  
  try {
    conn = await mysql.createConnection(dbConfig);
    
    const [existingOrder] = await conn.execute(
      'SELECT Status FROM ERP_Orders WHERE Ord_id = ?',
      [orderId]
    );
    
    if (existingOrder.length > 0) {
      return existingOrder[0].Status;
    }
    
    return null;
  } catch (error) {
    console.error('❌ Ошибка получения предыдущего статуса:', error);
    return null;
  } finally {
    if (conn) await conn.end();
  }
}

// ===============================
// 🔧 ДОПОЛНИТЕЛЬНЫЕ ЭНДПОИНТЫ ДЛЯ ТЕСТИРОВАНИЯ
// ===============================

// Эндпоинт для принудительного обновления склада (для тестирования)
app.post('/update-stock-manually', async (req, res) => {
  try {
    const { order_id, api_key } = req.body;
    
    if (process.env.API_KEY && api_key !== process.env.API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!order_id) {
      return res.status(400).json({ error: "Не указан order_id" });
    }

    // Получаем данные заказа
    const conn = await mysql.createConnection(dbConfig);
    const [orders] = await conn.execute(`
      SELECT o.Ord_id, o.Status, oi.Unit_to_ord_id, oi.Quantity, uto.Name 
      FROM ERP_Orders o
      JOIN ERP_Order_Items oi ON o.Ord_id = oi.Ord_id
      JOIN ERP_Unit_To_Ord uto ON oi.Unit_to_ord_id = uto.Unit_to_ord_id
      WHERE o.Ord_id = ?
    `, [order_id]);
    
    await conn.end();

    if (orders.length === 0) {
      return res.status(404).json({ error: 'Заказ не найден' });
    }
    
    const orderData = {
      receipt_id: order_id,
      status: orders[0].Status,
      products: orders.map(item => ({
        id: item.Unit_to_ord_id,
        name: item.Name,
        quantity: item.Quantity
      }))
    };
    
    const result = await updateWarehouseStock(orderData);
    
    res.json({
      success: true,
      message: 'Склад обновлен вручную',
      details: result
    });
    
  } catch (error) {
    console.error('❌ Ошибка ручного обновления склада:', error);
    res.status(500).json({ error: error.message });
  }
});

// Эндпоинт для проверки состояния склада
app.get('/warehouse-status', async (req, res) => {
  try {
    if (process.env.API_KEY && req.query.api_key !== process.env.API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const conn = await mysql.createConnection(dbConfig);
    const [stock] = await conn.execute(`
      SELECT Unit_id, Name, Specs, Amount, Status 
      FROM ERP_Unit_In_Storage 
      ORDER BY Name
    `);
    
    await conn.end();
    
    res.json({
      success: true,
      items: stock,
      totalItems: stock.length
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения состояния склада:', error);
    res.status(500).json({ error: error.message });
  }
});


// ===============================
// 👥 GET /get-contractors — получение списка контрагентов (поставщиков)
// ===============================
app.get("/get-contractors", async (req, res) => {
  try {
    if (process.env.API_KEY && req.query.api_key !== process.env.API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const conn = await mysql.createConnection(dbConfig);

    const [rows] = await conn.execute(`
      SELECT 
        s.Supplier_id as id,
        s.Short_name as name,
        s.Full_name as full_name,
        s.Inn as inn,
        s.Type as type,
        s.Ogrn as ogrn,
        s.Reg_date as reg_date,
        s.Ur_address as legal_address,
        s.Fact_address as actual_address,
        s.Phone_number as phone,
        s.Email as email,
        s.Website as website,
        s.Bank_name as bank_name,
        s.Bik as bik,
        s.Corr_acc as corr_account,
        s.Curr_acc as current_account,
        CONCAT(cp.Fio, ' - ', cp.Post) as contact_person,
        cp.Fio as contact_name,
        cp.Post as contact_position,
        cp.Phone_number as contact_phone,
        cp.Email as contact_email
      FROM ERP_Supplier s
      LEFT JOIN ERP_Contact_Person cp ON s.Contact_person = cp.Cont_pers_id
      ORDER BY s.Short_name
    `);

    await conn.end();

    // Форматируем данные для фронтенда
    const contractors = rows.map(row => ({
      id: row.id,
      name: row.name,
      full_name: row.full_name,
      inn: row.inn,
      type: row.type,
      ogrn: row.ogrn,
      reg_date: row.reg_date ? new Date(row.reg_date).toLocaleDateString('ru-RU') : null,
      legal_address: row.legal_address,
      actual_address: row.actual_address,
      phone: row.phone,
      email: row.email,
      website: row.website,
      bank_name: row.bank_name,
      bik: row.bik,
      corr_account: row.corr_account,
      current_account: row.current_account,
      contact_person: row.contact_person,
      contact_name: row.contact_name,
      contact_position: row.contact_position,
      contact_phone: row.contact_phone,
      contact_email: row.contact_email
    }));

    res.json(contractors);
  } catch (err) {
    console.error("Ошибка в /get-contractors:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});

// ===============================
// ➕ POST /add-contractor — добавление нового контрагента
// ===============================
app.post("/add-contractor", async (req, res) => {
  try {
    if (process.env.API_KEY && req.query.api_key !== process.env.API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const {
      name, inn, contact_name, contact_position, contact_phone, contact_email,
      full_name, type, ogrn, legal_address, actual_address, phone, email,
      website, bank_name, bik, corr_account, current_account
    } = req.body;

    const conn = await mysql.createConnection(dbConfig);
    await conn.beginTransaction();

    try {
      // 1. Сначала добавляем контактное лицо
      const [maxContactId] = await conn.execute('SELECT MAX(Cont_pers_id) as maxId FROM ERP_Contact_Person');
      const nextContactId = (maxContactId[0].maxId || 0) + 1;

      await conn.execute(
        `INSERT INTO ERP_Contact_Person (Cont_pers_id, Fio, Post, Phone_number, Email)
         VALUES (?, ?, ?, ?, ?)`,
        [nextContactId, contact_name, contact_position, contact_phone, contact_email]
      );

      // 2. Добавляем поставщика
      const [maxSupplierId] = await conn.execute('SELECT MAX(Supplier_id) as maxId FROM ERP_Supplier');
      const nextSupplierId = (maxSupplierId[0].maxId || 0) + 1;

      await conn.execute(
        `INSERT INTO ERP_Supplier (
          Supplier_id, Type, Short_name, Full_name, Inn, Ogrn,
          Reg_date, Ur_address, Fact_address, Phone_number, Email, Website,
          Bank_name, Bik, Corr_acc, Curr_acc, Contact_person
        ) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nextSupplierId, type || 'ООО', name, full_name || name, inn, ogrn,
          legal_address, actual_address || legal_address, phone, email, website,
          bank_name, bik, corr_account, current_account, nextContactId
        ]
      );

      await conn.commit();
      
      res.status(200).json({
        status: "success",
        message: "Контрагент успешно добавлен",
        contractor_id: nextSupplierId
      });

    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      await conn.end();
    }

  } catch (err) {
    console.error("Ошибка в /add-contractor:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});

// ===============================
// ✏️ PUT /update-contractor — обновление данных контрагента
// ===============================
app.put("/update-contractor", async (req, res) => {
  try {
    if (process.env.API_KEY && req.query.api_key !== process.env.API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const {
      id, name, inn, contact_name, contact_position, contact_phone, contact_email,
      full_name, type, ogrn, legal_address, actual_address, phone, email,
      website, bank_name, bik, corr_account, current_account
    } = req.body;

    if (!id) {
      return res.status(400).json({ error: "Не указан ID контрагента" });
    }

    const conn = await mysql.createConnection(dbConfig);
    await conn.beginTransaction();

    try {
      // 1. Получаем ID контактного лица
      const [supplierRows] = await conn.execute(
        'SELECT Contact_person FROM ERP_Supplier WHERE Supplier_id = ?',
        [id]
      );

      if (supplierRows.length === 0) {
        throw new Error("Контрагент не найден");
      }

      const contactPersonId = supplierRows[0].Contact_person;

      // 2. Обновляем контактное лицо
      await conn.execute(
        `UPDATE ERP_Contact_Person SET Fio = ?, Post = ?, Phone_number = ?, Email = ?
         WHERE Cont_pers_id = ?`,
        [contact_name, contact_position, contact_phone, contact_email, contactPersonId]
      );

      // 3. Обновляем поставщика
      await conn.execute(
        `UPDATE ERP_Supplier SET
          Type = ?, Short_name = ?, Full_name = ?, Inn = ?, Ogrn = ?,
          Ur_address = ?, Fact_address = ?, Phone_number = ?, Email = ?, Website = ?,
          Bank_name = ?, Bik = ?, Corr_acc = ?, Curr_acc = ?
         WHERE Supplier_id = ?`,
        [
          type || 'ООО', name, full_name || name, inn, ogrn,
          legal_address, actual_address || legal_address, phone, email, website,
          bank_name, bik, corr_account, current_account, id
        ]
      );

      await conn.commit();
      
      res.status(200).json({
        status: "success",
        message: "Данные контрагента обновлены"
      });

    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      await conn.end();
    }

  } catch (err) {
    console.error("Ошибка в /update-contractor:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});

// ===============================
// 🔍 GET /search-contractors — поиск контрагентов
// ===============================
app.get("/search-contractors", async (req, res) => {
  try {
    if (process.env.API_KEY && req.query.api_key !== process.env.API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { query } = req.query;

    if (!query) {
      return res.json([]);
    }

    const conn = await mysql.createConnection(dbConfig);

    const [rows] = await conn.execute(`
      SELECT 
        s.Supplier_id as id,
        s.Short_name as name,
        s.Full_name as full_name,
        s.Inn as inn,
        CONCAT(cp.Fio, ' - ', cp.Post) as contact_person,
        cp.Phone_number as contact_phone,
        cp.Email as contact_email
      FROM ERP_Supplier s
      LEFT JOIN ERP_Contact_Person cp ON s.Contact_person = cp.Cont_pers_id
      WHERE s.Short_name LIKE ? OR s.Full_name LIKE ? OR s.Inn LIKE ?
      ORDER BY s.Short_name
      LIMIT 10
    `, [`%${query}%`, `%${query}%`, `%${query}%`]);

    await conn.end();
    res.json(rows);
  } catch (err) {
    console.error("Ошибка в /search-contractors:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});

// ===============================
// 📋 GET /get-contractor-details — получение детальной информации о контрагенте
// ===============================
app.get("/get-contractor-details", async (req, res) => {
  try {
    if (process.env.API_KEY && req.query.api_key !== process.env.API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ error: "Не указан ID контрагента" });
    }

    const conn = await mysql.createConnection(dbConfig);

    const [rows] = await conn.execute(`
      SELECT 
        s.Supplier_id as id,
        s.Short_name as name,
        s.Full_name as full_name,
        s.Inn as inn,
        s.Type as type,
        s.Kpp as kpp,
        s.Okpo as okpo,
        s.Ogrn as ogrn,
        s.Reg_date as reg_date,
        s.Ur_address as legal_address,
        s.Fact_address as actual_address,
        s.Phone_number as phone,
        s.Email as email,
        s.Website as website,
        s.Bank_name as bank_name,
        s.Bik as bik,
        s.Corr_acc as corr_account,
        s.Curr_acc as current_account,
        cp.Cont_pers_id as contact_id,
        cp.Fio as contact_name,
        cp.Post as contact_position,
        cp.Phone_number as contact_phone,
        cp.Email as contact_email
      FROM ERP_Supplier s
      LEFT JOIN ERP_Contact_Person cp ON s.Contact_person = cp.Cont_pers_id
      WHERE s.Supplier_id = ?
    `, [id]);

    await conn.end();

    if (rows.length === 0) {
      return res.status(404).json({ error: "Контрагент не найден" });
    }

    const contractor = rows[0];
    
    // Форматируем дату
    if (contractor.reg_date) {
      contractor.reg_date = new Date(contractor.reg_date).toLocaleDateString('ru-RU');
    }

    res.json(contractor);
  } catch (err) {
    console.error("Ошибка в /get-contractor-details:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});



// ===============================
// 🚀 Запуск сервера
// ===============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ API listening on port ${PORT}`));
