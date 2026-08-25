const { pool } = require('./db');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// أدوات مساعدة
// ---------------------------------------------------------------------------

function computeEffectiveStatus(license) {
    // اللايسنس "Lifetime" مفيهوش expires_at، فمينفعش يتحسب منتهي أبداً
    const isExpired = license.expires_at ? new Date(license.expires_at) < new Date() : false;
    if (license.status === 'active' && isExpired) return 'expired';
    return license.status;
}

async function logAdminAction(licenseKey, action, details = {}) {
    try {
        await pool.query(
            `INSERT INTO admin_actions_log (license_key, action, details) VALUES ($1, $2, $3)`,
            [licenseKey, action, details]
        );
    } catch (error) {
        console.error('Failed to write admin action log:', error);
    }
}

function serializeLicense(license, devices = null) {
    return {
        key: license.license_key,
        type: license.license_type,
        status: computeEffectiveStatus(license),
        deviceLimit: license.device_limit,
        expiresAt: license.expires_at,
        createdAt: license.created_at,
        ...(devices ? { devices } : {})
    };
}

// ---------------------------------------------------------------------------
// 1) تفعيل كود على جهاز (Activation)
// ---------------------------------------------------------------------------

async function activateLicense(req, res) {
    const { licenseKey, deviceId, deviceLabel } = req.body;

    if (!licenseKey || !deviceId) {
        return res.status(400).json({ success: false, message: 'Activation code and device ID are required.' });
    }

    const normalizedKey = licenseKey.trim().toUpperCase();

    try {
        const licenseResult = await pool.query('SELECT * FROM licenses WHERE license_key = $1', [normalizedKey]);

        if (licenseResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Invalid activation code.' });
        }

        const license = licenseResult.rows[0];

        if (license.status === 'revoked') {
            return res.status(403).json({ success: false, message: 'This activation code has been revoked.' });
        }
        if (license.status === 'suspended') {
            return res.status(403).json({ success: false, message: 'This activation code is currently suspended.' });
        }
        if (license.expires_at && new Date(license.expires_at) < new Date()) {
            return res.status(400).json({ success: false, message: 'This activation code has expired.' });
        }

        const deviceResult = await pool.query(
            'SELECT * FROM license_devices WHERE license_id = $1 AND device_id = $2',
            [license.id, deviceId]
        );

        if (deviceResult.rows.length > 0) {
            // الجهاز ده مفعّل بالفعل على الكود ده - نحدث last_seen ونرجّعه عادي بدل ما نرفضه
            const existingDevice = deviceResult.rows[0];
            if (existingDevice.status === 'deactivated') {
                return res.status(403).json({ success: false, message: 'This device has been deactivated for this license. Contact support.' });
            }
            await pool.query(
                `UPDATE license_devices SET last_seen = CURRENT_TIMESTAMP, device_label = COALESCE($1, device_label) WHERE id = $2`,
                [deviceLabel || null, existingDevice.id]
            );
        } else {
            // جهاز جديد - نتأكد إن عدد الأجهزة النشطة تحت الحد المسموح قبل ما نضيفه
            const activeCountResult = await pool.query(
                `SELECT COUNT(*)::int AS count FROM license_devices WHERE license_id = $1 AND status = 'active'`,
                [license.id]
            );
            const activeCount = activeCountResult.rows[0].count;

            if (activeCount >= license.device_limit) {
                return res.status(403).json({
                    success: false,
                    message: `This activation code has reached its device limit (${license.device_limit}). Deactivate another device first.`
                });
            }

            await pool.query(
                `INSERT INTO license_devices (license_id, device_id, device_label) VALUES ($1, $2, $3)`,
                [license.id, deviceId, deviceLabel || null]
            );
        }

        await logAdminAction(normalizedKey, 'device_activated', { deviceId });

        return res.status(200).json({
            success: true,
            message: 'IF-VIP activated successfully!',
            license: serializeLicense(license)
        });
    } catch (error) {
        console.error('License activation error:', error);
        return res.status(500).json({ success: false, message: 'Server error during license activation.' });
    }
}

// ---------------------------------------------------------------------------
// 2) فحص حالة اللايسنس لجهاز معيّن (بيتنادى عند فتح التطبيق + دورياً وهو شغال)
// ---------------------------------------------------------------------------

async function getLicenseStatus(req, res) {
    const { licenseKey, deviceId } = req.body;

    if (!licenseKey || !deviceId) {
        return res.status(400).json({ success: false, message: 'Activation code and device ID are required.' });
    }

    const normalizedKey = licenseKey.trim().toUpperCase();

    try {
        const licenseResult = await pool.query('SELECT * FROM licenses WHERE license_key = $1', [normalizedKey]);

        if (licenseResult.rows.length === 0) {
            return res.status(200).json({ success: true, valid: false, reason: 'not_found' });
        }

        const license = licenseResult.rows[0];
        const effectiveStatus = computeEffectiveStatus(license);

        // نحدّث حالة "expired" في القاعدة نفسها عشان تفضل متسقة مع أي استعلام تاني (زي الأدمن بانل)
        if (effectiveStatus === 'expired' && license.status !== 'expired') {
            await pool.query(`UPDATE licenses SET status = 'expired' WHERE license_key = $1`, [normalizedKey]);
        }

        const deviceResult = await pool.query(
            'SELECT * FROM license_devices WHERE license_id = $1 AND device_id = $2',
            [license.id, deviceId]
        );

        if (deviceResult.rows.length === 0 || deviceResult.rows[0].status !== 'active') {
            return res.status(200).json({
                success: true,
                valid: false,
                reason: 'device_not_authorized',
                license: serializeLicense(license)
            });
        }

        if (effectiveStatus !== 'active') {
            return res.status(200).json({
                success: true,
                valid: false,
                reason: effectiveStatus, // 'expired' | 'revoked' | 'suspended'
                license: serializeLicense(license)
            });
        }

        await pool.query('UPDATE license_devices SET last_seen = CURRENT_TIMESTAMP WHERE id = $1', [deviceResult.rows[0].id]);

        return res.status(200).json({
            success: true,
            valid: true,
            license: serializeLicense(license)
        });
    } catch (error) {
        console.error('License status error:', error);
        return res.status(500).json({ success: false, message: 'Server error while checking license status.' });
    }
}

// ---------------------------------------------------------------------------
// 3) توليد كود جديد (أدمن فقط)
// ---------------------------------------------------------------------------

const DURATION_DAYS_BY_TYPE = {
    '3-Day Trial': 3,
    '1 Week': 7,
    '1 Month': 30,
    '1 Year': 365
    // 'Lifetime' → expires_at = NULL
};

async function generateLicense(req, res) {
    const { licenseType, deviceLimit } = req.body;

    if (!licenseType) {
        return res.status(400).json({ success: false, message: 'licenseType is required.' });
    }
    if (licenseType !== 'Lifetime' && !DURATION_DAYS_BY_TYPE[licenseType]) {
        return res.status(400).json({
            success: false,
            message: `licenseType must be one of: ${[...Object.keys(DURATION_DAYS_BY_TYPE), 'Lifetime'].join(', ')}`
        });
    }

    try {
        // توليد عشوائي غير متسلسل باستخدام crypto - مش أرقام تسلسلية يمكن تخمينها
        const randomPart = crypto.randomBytes(8).toString('hex').toUpperCase();
        const licenseKey = `IFVIP-${randomPart.slice(0, 4)}-${randomPart.slice(4, 8)}-${randomPart.slice(8, 12)}-${randomPart.slice(12, 16)}`;

        let expiresAt = null;
        if (licenseType !== 'Lifetime') {
            expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + DURATION_DAYS_BY_TYPE[licenseType]);
        }

        const newLicense = await pool.query(
            `INSERT INTO licenses (license_key, license_type, expires_at, device_limit, status)
             VALUES ($1, $2, $3, $4, 'active')
             RETURNING *`,
            [licenseKey, licenseType, expiresAt, Number(deviceLimit) > 0 ? Number(deviceLimit) : 1]
        );

        await logAdminAction(licenseKey, 'license_generated', { licenseType, deviceLimit: deviceLimit || 1 });

        return res.status(201).json({
            success: true,
            message: 'License generated successfully!',
            license: serializeLicense(newLicense.rows[0])
        });
    } catch (error) {
        console.error('License generation error:', error);
        return res.status(500).json({ success: false, message: 'Server error during license generation.' });
    }
}

// ---------------------------------------------------------------------------
// 4) إدارة الأدمن: قائمة التراخيص + إحصائيات
// ---------------------------------------------------------------------------

async function listLicenses(req, res) {
    try {
        const result = await pool.query('SELECT * FROM licenses ORDER BY created_at DESC LIMIT 500');
        const licenses = result.rows.map((l) => serializeLicense(l));

        const summary = licenses.reduce((acc, l) => {
            acc[l.status] = (acc[l.status] || 0) + 1;
            acc.total += 1;
            return acc;
        }, { total: 0 });

        return res.status(200).json({ success: true, summary, licenses });
    } catch (error) {
        console.error('List licenses error:', error);
        return res.status(500).json({ success: false, message: 'Server error while listing licenses.' });
    }
}

async function findLicenseOr404(licenseKey, res) {
    const normalizedKey = licenseKey.trim().toUpperCase();
    const result = await pool.query('SELECT * FROM licenses WHERE license_key = $1', [normalizedKey]);
    if (result.rows.length === 0) {
        res.status(404).json({ success: false, message: 'License not found.' });
        return null;
    }
    return result.rows[0];
}

// دالة عامة لتغيير حالة اللايسنس (revoke / suspend / reactivate)
function makeStatusUpdater(newStatus, actionLabel) {
    return async function updateStatus(req, res) {
        const { licenseKey } = req.params;
        try {
            const license = await findLicenseOr404(licenseKey, res);
            if (!license) return;

            await pool.query('UPDATE licenses SET status = $1 WHERE id = $2', [newStatus, license.id]);
            await logAdminAction(license.license_key, actionLabel, {});

            return res.status(200).json({ success: true, message: `License ${actionLabel.replace('_', ' ')}.` });
        } catch (error) {
            console.error(`${actionLabel} error:`, error);
            return res.status(500).json({ success: false, message: 'Server error while updating license status.' });
        }
    };
}

const revokeLicense = makeStatusUpdater('revoked', 'license_revoked');
const suspendLicense = makeStatusUpdater('suspended', 'license_suspended');
const reactivateLicense = makeStatusUpdater('active', 'license_reactivated');

async function extendLicense(req, res) {
    const { licenseKey } = req.params;
    const { days } = req.body;

    if (!days || isNaN(Number(days))) {
        return res.status(400).json({ success: false, message: 'A numeric "days" value is required.' });
    }

    try {
        const license = await findLicenseOr404(licenseKey, res);
        if (!license) return;

        if (!license.expires_at) {
            return res.status(400).json({ success: false, message: 'This is a Lifetime license and has no expiration to extend.' });
        }

        const base = new Date(license.expires_at) > new Date() ? new Date(license.expires_at) : new Date();
        base.setDate(base.getDate() + Number(days));

        await pool.query('UPDATE licenses SET expires_at = $1 WHERE id = $2', [base, license.id]);
        await logAdminAction(license.license_key, 'license_extended', { days: Number(days) });

        return res.status(200).json({ success: true, message: 'License extended.', newExpiresAt: base });
    } catch (error) {
        console.error('Extend license error:', error);
        return res.status(500).json({ success: false, message: 'Server error while extending license.' });
    }
}

async function changeLicenseType(req, res) {
    const { licenseKey } = req.params;
    const { licenseType } = req.body;

    if (!licenseType || (licenseType !== 'Lifetime' && !DURATION_DAYS_BY_TYPE[licenseType])) {
        return res.status(400).json({
            success: false,
            message: `licenseType must be one of: ${[...Object.keys(DURATION_DAYS_BY_TYPE), 'Lifetime'].join(', ')}`
        });
    }

    try {
        const license = await findLicenseOr404(licenseKey, res);
        if (!license) return;

        const expiresAt = licenseType === 'Lifetime'
            ? null
            : (() => { const d = new Date(); d.setDate(d.getDate() + DURATION_DAYS_BY_TYPE[licenseType]); return d; })();

        await pool.query('UPDATE licenses SET license_type = $1, expires_at = $2 WHERE id = $3', [licenseType, expiresAt, license.id]);
        await logAdminAction(license.license_key, 'license_type_changed', { licenseType });

        return res.status(200).json({ success: true, message: 'License type updated.' });
    } catch (error) {
        console.error('Change license type error:', error);
        return res.status(500).json({ success: false, message: 'Server error while changing license type.' });
    }
}

async function setDeviceLimit(req, res) {
    const { licenseKey } = req.params;
    const { limit } = req.body;

    if (!limit || isNaN(Number(limit)) || Number(limit) < 1) {
        return res.status(400).json({ success: false, message: 'A positive numeric "limit" value is required.' });
    }

    try {
        const license = await findLicenseOr404(licenseKey, res);
        if (!license) return;

        await pool.query('UPDATE licenses SET device_limit = $1 WHERE id = $2', [Number(limit), license.id]);
        await logAdminAction(license.license_key, 'device_limit_changed', { limit: Number(limit) });

        return res.status(200).json({ success: true, message: 'Device limit updated.' });
    } catch (error) {
        console.error('Set device limit error:', error);
        return res.status(500).json({ success: false, message: 'Server error while updating device limit.' });
    }
}

// ---------------------------------------------------------------------------
// 5) إدارة الأدمن: الأجهزة المفعّلة على لايسنس معيّن
// ---------------------------------------------------------------------------

async function listDevices(req, res) {
    const { licenseKey } = req.params;
    try {
        const license = await findLicenseOr404(licenseKey, res);
        if (!license) return;

        const devicesResult = await pool.query(
            'SELECT device_id, device_label, status, activated_at, last_seen FROM license_devices WHERE license_id = $1 ORDER BY activated_at DESC',
            [license.id]
        );

        return res.status(200).json({ success: true, license: serializeLicense(license), devices: devicesResult.rows });
    } catch (error) {
        console.error('List devices error:', error);
        return res.status(500).json({ success: false, message: 'Server error while listing devices.' });
    }
}

async function deactivateDevice(req, res) {
    const { licenseKey, deviceId } = req.params;
    try {
        const license = await findLicenseOr404(licenseKey, res);
        if (!license) return;

        const result = await pool.query(
            `UPDATE license_devices SET status = 'deactivated' WHERE license_id = $1 AND device_id = $2 RETURNING id`,
            [license.id, deviceId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Device not found on this license.' });
        }

        await logAdminAction(license.license_key, 'device_deactivated', { deviceId });
        return res.status(200).json({ success: true, message: 'Device deactivated. It can no longer use this license.' });
    } catch (error) {
        console.error('Deactivate device error:', error);
        return res.status(500).json({ success: false, message: 'Server error while deactivating device.' });
    }
}

// بيقفل جهاز قديم ويفتح مكانه فوراً لجهاز جديد على نفس اللايسنس (بديل عملي لنقل الترخيص لجهاز تاني)
async function replaceDevice(req, res) {
    const { licenseKey } = req.params;
    const { oldDeviceId, newDeviceId, newDeviceLabel } = req.body;

    if (!oldDeviceId || !newDeviceId) {
        return res.status(400).json({ success: false, message: 'oldDeviceId and newDeviceId are required.' });
    }

    try {
        const license = await findLicenseOr404(licenseKey, res);
        if (!license) return;

        await pool.query(
            `UPDATE license_devices SET status = 'deactivated' WHERE license_id = $1 AND device_id = $2`,
            [license.id, oldDeviceId]
        );

        await pool.query(
            `INSERT INTO license_devices (license_id, device_id, device_label)
             VALUES ($1, $2, $3)
             ON CONFLICT (license_id, device_id) DO UPDATE SET status = 'active', device_label = EXCLUDED.device_label`,
            [license.id, newDeviceId, newDeviceLabel || null]
        );

        await logAdminAction(license.license_key, 'device_replaced', { oldDeviceId, newDeviceId });
        return res.status(200).json({ success: true, message: 'Device replaced successfully.' });
    } catch (error) {
        console.error('Replace device error:', error);
        return res.status(500).json({ success: false, message: 'Server error while replacing device.' });
    }
}

module.exports = {
    activateLicense,
    getLicenseStatus,
    generateLicense,
    listLicenses,
    revokeLicense,
    suspendLicense,
    reactivateLicense,
    extendLicense,
    changeLicenseType,
    setDeviceLimit,
    listDevices,
    deactivateDevice,
    replaceDevice
};
