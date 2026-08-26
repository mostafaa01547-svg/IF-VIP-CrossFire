const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// بيشيل الـ Menu Bar الافتراضي (File / Edit / View / Window / Help) من كل شبابيك التطبيق
Menu.setApplicationMenu(null);

let mainWindow;

// خريطة كل شاشة بالمسار بتاعها - بيتضاف هنا أي شاشة جديدة
// مفيش Login/Sign Up/Welcome خالص - النظام كله قائم على Activation Code فقط
const SCREENS = {
    activation: '../Authentication/activation.html',
    'activation-success': '../Authentication/activation-success.html',
    expired: '../Authentication/expired.html',
    revoked: '../Authentication/revoked.html',
    dashboard: '../Core/dashboard.html'
};

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 720,
        minWidth: 900,
        minHeight: 620,
        frame: true,
        autoHideMenuBar: true, // احتياطي: حتى لو المنيو رجع لأي سبب، يفضل مخفي
        icon: path.join(__dirname, '../Assets/icon.ico'),
        backgroundColor: '#06060a',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.setMenuBarVisibility(false);

    // أول شاشة دايماً هي شاشة التفعيل - هي نفسها بتتحقق أونلاين لو فيه كود متفعّل قبل كده وتوجّه تلقائي
    navigateTo('activation');
}

// بيحمّل الشاشة المطلوبة، وبعد ما تخلص تحميل بيبعتلها أي باراميترز (زي رسالة خطأ أو بيانات لايسنس)
function navigateTo(screen, params = {}) {
    const relativePath = SCREENS[screen];
    if (!relativePath) {
        console.error(`Unknown IF-VIP screen: ${screen}`);
        return;
    }

    mainWindow.loadFile(path.join(__dirname, relativePath));

    mainWindow.webContents.once('did-finish-load', () => {
        const safeParams = JSON.stringify(params || {});
        mainWindow.webContents.executeJavaScript(`window.ifvipNavParams = ${safeParams};`).catch(() => {});
    });
}

// ---------------------------------------------------------------------------
// معرّف جهاز محلي دائم - مش بصمة هاردوير، مجرد UUID عشوائي بيتخزن مرة واحدة
// في مجلد بيانات المستخدم الخاص بالتطبيق ويتقرأ بعد كده. بيستخدم فقط لربط
// كود التفعيل بالجهاز (حد أقصى لعدد الأجهزة لكل كود) - مفيش أي بيانات هاردوير
// حساسة بتتجمع أو بتتبعت للسيرفر.
// ---------------------------------------------------------------------------
function getOrCreateDeviceId() {
    const deviceFilePath = path.join(app.getPath('userData'), 'device.json');

    try {
        if (fs.existsSync(deviceFilePath)) {
            const data = JSON.parse(fs.readFileSync(deviceFilePath, 'utf-8'));
            if (data.deviceId) return data.deviceId;
        }
    } catch (err) {
        console.warn('Could not read existing device.json, generating a new device ID:', err.message);
    }

    const deviceId = crypto.randomUUID();
    try {
        fs.mkdirSync(path.dirname(deviceFilePath), { recursive: true });
        fs.writeFileSync(deviceFilePath, JSON.stringify({ deviceId }), 'utf-8');
    } catch (err) {
        console.error('Could not persist device.json:', err.message);
    }
    return deviceId;
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// كل الشاشات بتنادي navigate بدل ما تعرف مسارات الملفات، عشان الـ routing يبقى مركزي هنا
ipcMain.on('navigate', (event, screen, params) => {
    navigateTo(screen, params);
});

ipcMain.handle('get-device-id', () => {
    return getOrCreateDeviceId();
});

ipcMain.on('app-quit', () => {
    app.quit();
});
