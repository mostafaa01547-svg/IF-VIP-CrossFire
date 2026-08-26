const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { initializeDatabase } = require('./db');
const {
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
} = require('./licenseController');
const { requireAdmin } = require('./middleware/adminAuth');
const path = require('path');
const { activationLimiter, statusLimiter, adminLimiter } = require('./middleware/rateLimiter');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/status', (req, res) => {
    res.json({
        status: 'success',
        message: 'IF-VIP Backend Server is running securely!',
        timestamp: new Date()
    });
});

// ---------- Licensing (Activation Code only - no accounts) ----------
app.post('/api/license/activate', activationLimiter, activateLicense);
app.post('/api/license/status', statusLimiter, getLicenseStatus); // بيتنادى عند فتح التطبيق + دورياً وهو شغال

// ---------- Admin: License management (protected by x-admin-key) ----------
app.post('/api/admin/license/generate', requireAdmin, adminLimiter, generateLicense);
app.get('/api/admin/licenses', requireAdmin, adminLimiter, listLicenses);
app.post('/api/admin/license/:licenseKey/revoke', requireAdmin, adminLimiter, revokeLicense);
app.post('/api/admin/license/:licenseKey/suspend', requireAdmin, adminLimiter, suspendLicense);
app.post('/api/admin/license/:licenseKey/reactivate', requireAdmin, adminLimiter, reactivateLicense);
app.post('/api/admin/license/:licenseKey/extend', requireAdmin, adminLimiter, extendLicense);
app.post('/api/admin/license/:licenseKey/change-type', requireAdmin, adminLimiter, changeLicenseType);
app.post('/api/admin/license/:licenseKey/device-limit', requireAdmin, adminLimiter, setDeviceLimit);

// ---------- Admin: Device management ----------
app.get('/api/admin/license/:licenseKey/devices', requireAdmin, adminLimiter, listDevices);
app.post('/api/admin/license/:licenseKey/devices/:deviceId/deactivate', requireAdmin, adminLimiter, deactivateDevice);
app.post('/api/admin/license/:licenseKey/devices/replace', requireAdmin, adminLimiter, replaceDevice);

async function startServer() {
    try {
        await initializeDatabase();
        app.listen(PORT, () => {
            console.log(`IF-VIP Server is running on port ${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start server due to database error:', error);
    }
}

startServer();
