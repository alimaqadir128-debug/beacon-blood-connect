const express = require("express");
const cors = require("cors");
const path = require("path");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

// ─── Serve the frontend folder ───────────────────────────────────────────────
app.use("/frontend", express.static(path.join(__dirname, "frontend")));

// ─── DATABASE ─────────────────────────────────────────────────────────────────
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Create tables if they don't exist yet
const initDB = async () => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS donors (
            id          SERIAL PRIMARY KEY,
            name        TEXT    NOT NULL,
            phone       TEXT    NOT NULL,
            blood_group TEXT    NOT NULL,
            area_name   TEXT,
            lat         DOUBLE PRECISION DEFAULT 34.298,
            lng         DOUBLE PRECISION DEFAULT 74.466,
            created_at  TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS requests (
            id             SERIAL PRIMARY KEY,
            patient_name   TEXT,
            hospital_name  TEXT,
            blood_group    TEXT,
            contact_phone  TEXT,
            area_name      TEXT,
            lat            DOUBLE PRECISION DEFAULT 34.298,
            lng            DOUBLE PRECISION DEFAULT 74.466,
            created_at     TIMESTAMP DEFAULT NOW()
        )
    `);
    console.log("✅  Tables ready.");
};

// ─── SEED DATA ────────────────────────────────────────────────────────────────
const seedDatabase = async () => {
    const donors = [
        // name,         phone,          blood_group, area,         lat,      lng
        ['Aana',       '9876543210',    'O-',  'Sopore',    34.2980, 74.4660],
        ['Ali',        '9123456780',    'O+',  'Soura',     34.1350, 74.8010],
        ['Omer',       '9797123234',    'A+',  'Sopore',    34.2985, 74.4670],
        ['Suleiman',   '6006899023',    'B+',  'Sopore',    34.2975, 74.4650],
        ['Zacky',      '9622001122',    'B-',  'Baramulla', 34.2010, 74.3410],
        ['Meera',      '9811223344',    'A-',  'Srinagar',  34.0836, 74.7973],
        ['Farhan',     '9900112233',    'AB+', 'Anantnag',  33.7311, 75.1487],
        ['Hina',       '9988776655',    'AB-', 'Pulwama',   33.8796, 74.8989],
    ];

    let inserted = 0;
    for (const d of donors) {
        const result = await pool.query(
            `INSERT INTO donors (name, phone, blood_group, area_name, lat, lng)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT DO NOTHING`,
            d
        );
        inserted += result.rowCount;
    }
    console.log(`✅  Seed complete — ${inserted} new donor(s) added.`);
};

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// Health check
app.get("/", (req, res) => res.json({ status: "BEACON API running 🩸" }));

// Seed endpoint (admin)
app.get("/seed", async (req, res) => {
    try {
        await seedDatabase();
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Reset DB (admin)
app.post("/reset", async (req, res) => {
    try {
        await pool.query("TRUNCATE TABLE donors, requests RESTART IDENTITY");
        await seedDatabase();
        res.json({ message: "DB reset and re-seeded." });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// GET donors — optionally filter by blood_group
app.get("/donors", async (req, res) => {
    try {
        const { blood_group } = req.query;
        let query  = "SELECT * FROM donors";
        let params = [];

        if (blood_group && blood_group !== "All") {
            query += " WHERE TRIM(blood_group) = $1";
            params.push(blood_group.trim());
        }

        query += " ORDER BY id ASC";
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// GET SOS requests
app.get("/requests", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM requests ORDER BY id DESC");
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// POST new donor  ← FIXED: validates coords are not (0,0) or default
app.post("/donors", async (req, res) => {
    try {
        const { name, phone, blood_group, area_name, lat, lng } = req.body;

        // Basic validation
        if (!name || !phone || !blood_group) {
            return res.status(400).json({ error: "name, phone, blood_group are required." });
        }

        // Ensure lat/lng are valid finite numbers, else fall back to default
        const safeLat = (isFinite(lat) && lat !== 0) ? lat : 34.298;
        const safeLng = (isFinite(lng) && lng !== 0) ? lng : 74.466;

        await pool.query(
            `INSERT INTO donors (name, phone, blood_group, area_name, lat, lng)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [name, phone, blood_group.trim(), area_name || '', safeLat, safeLng]
        );
        res.sendStatus(201);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// POST new SOS request  ← FIXED: validates coords are not (0,0) or default
app.post("/requests", async (req, res) => {
    try {
        const { patient_name, hospital_name, blood_group, contact_phone, area_name, lat, lng } = req.body;

        if (!hospital_name || !blood_group || !contact_phone) {
            return res.status(400).json({ error: "hospital_name, blood_group, contact_phone are required." });
        }

        const safeLat = (isFinite(lat) && lat !== 0) ? lat : 34.298;
        const safeLng = (isFinite(lng) && lng !== 0) ? lng : 74.466;

        await pool.query(
            `INSERT INTO requests (patient_name, hospital_name, blood_group, contact_phone, area_name, lat, lng)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [patient_name || 'Unknown', hospital_name, blood_group.trim(),
             contact_phone, area_name || '', safeLat, safeLng]
        );
        res.sendStatus(201);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

app.listen(PORT, async () => {
    console.log(`\n🚀  BEACON Server running on http://127.0.0.1:${PORT}`);
    try {
        await initDB();
        await seedDatabase();
    } catch (err) {
        console.error("Startup error:", err.message);
    }
});