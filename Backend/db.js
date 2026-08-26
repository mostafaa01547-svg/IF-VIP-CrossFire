const { Pool } = require('pg');
require('dotenv').config();

// إنشاء اتصال بقاعدة بيانات PostgreSQL باستخدام متغيرات البيئة
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // لو بتشتغل محلي ومش مفعل SSL ممكن تشيله أو تظبطه حسب إعدادات جهازك
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// دالة لإنشاء جداول النظام تلقائياً لو مش موجودة
// النظام كله دلوقتي مبني على Activation Code فقط - مفيش حسابات مستخدمين أو باسوردات خالص
async function initializeDatabase() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. جدول التراخيص (Licenses Table) - مصدر الحقيقة الوحيد لحالة أي كود تفعيل
        await client.query(`
            CREATE TABLE IF NOT EXISTS licenses (
                id SERIAL PRIMARY KEY,
                license_key VARCHAR(100) UNIQUE NOT NULL,
                license_type VARCHAR(50) NOT NULL, -- 3-Day Trial, 1 Week, 1 Month, 1 Year, Lifetime
                status VARCHAR(20) DEFAULT 'active', -- active, expired, suspended, revoked
                device_limit INT DEFAULT 1,
                expires_at TIMESTAMP, -- NULL = Lifetime
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 2. جدول الأجهزة المفعّلة على كل كود (Device Activations)
        // بيستخدم device_id مولّد محلياً على جهاز العميل - مش بصمة هاردوير غازية للخصوصية
        await client.query(`
            CREATE TABLE IF NOT EXISTS license_devices (
                id SERIAL PRIMARY KEY,
                license_id INT REFERENCES licenses(id) ON DELETE CASCADE,
                device_id VARCHAR(100) NOT NULL,
                device_label VARCHAR(150),
                status VARCHAR(20) DEFAULT 'active', -- active, deactivated
                activated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(license_id, device_id)
            );
        `);

        // 3. لوج بسيط لأي إجراء إداري - يفيد في الـ Audit لاحقاً من الـ Admin Panel
        await client.query(`
            CREATE TABLE IF NOT EXISTS admin_actions_log (
                id SERIAL PRIMARY KEY,
                license_key VARCHAR(100),
                action VARCHAR(50) NOT NULL,
                details JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await client.query('COMMIT');
        console.log('Database tables (Licenses, License Devices) initialized successfully.');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error initializing database tables:', error);
    } finally {
        client.release();
    }
}

pool.on('connect', () => {
    console.log('Connected to PostgreSQL database successfully.');
});

module.exports = {
    pool,
    initializeDatabase
};
