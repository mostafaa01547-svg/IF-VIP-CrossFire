// session.js
// إدارة حالة التفعيل الخاصة بالعميل - مفيش حسابات، مفيش باسورد، مفيش توكن مستخدم.
// بيتخزن محلياً بس كود التفعيل نفسه (عشان "يتذكر" التفعيل بين مرات التشغيل)،
// وكل مرة بيتأكد أونلاين من السيرفر إن الكود لسه شغال على الجهاز ده قبل ما يفتح أي حاجة.
// السيرفر هو مصدر الحقيقة الوحيد لحالة اللايسنس - التخزين المحلي هنا للراحة بس.

const API_BASE = 'https://if-vip-crossfire-production.up.railway.app/api';

const Session = {
    getLicenseKey() {
        return localStorage.getItem('ifvip_license_key');
    },

    setLicenseKey(key) {
        localStorage.setItem('ifvip_license_key', key);
    },

    clear() {
        localStorage.removeItem('ifvip_license_key');
        localStorage.removeItem('ifvip_last_license');
    },

    setLastLicense(license) {
        localStorage.setItem('ifvip_last_license', JSON.stringify(license));
    },

    getLastLicense() {
        const raw = localStorage.getItem('ifvip_last_license');
        return raw ? JSON.parse(raw) : null;
    },

    async getDeviceId() {
        const { ipcRenderer } = require('electron');
        return ipcRenderer.invoke('get-device-id');
    },

    async apiPost(path, body) {
        const response = await fetch(`${API_BASE}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        let data = null;
        try { data = await response.json(); } catch (_) { /* no body */ }

        return { ok: response.ok, status: response.status, data };
    },

    // بيتنادى عند فتح شاشة التفعيل - لو فيه كود متخزن، بيتحقق منه أونلاين
    // ويرجّع الشاشة اللي المفروض التطبيق يفتح عليها بدل ما يسيب المستخدم يدخل الكود تاني
    async resolveEntryScreen() {
        const licenseKey = this.getLicenseKey();
        if (!licenseKey) return { screen: 'activation' };

        const deviceId = await this.getDeviceId();

        try {
            const result = await this.apiPost('/license/status', { licenseKey, deviceId });

            if (!result.ok) {
                return { screen: 'activation' };
            }

            const { valid, reason, license } = result.data;

            if (license) this.setLastLicense(license);

            if (valid) {
                return { screen: 'dashboard', license };
            }

            if (reason === 'expired') return { screen: 'expired', license };
            if (reason === 'revoked' || reason === 'suspended' || reason === 'device_not_authorized') {
                return { screen: 'revoked', license };
            }

            // 'not_found' أو أي حالة غير معروفة - نمسح الكود المحفوظ ونرجع لشاشة التفعيل
            this.clear();
            return { screen: 'activation' };
        } catch (err) {
            // تعذر الاتصال بالسيرفر - نسيب المستخدم في شاشة التفعيل بدل ما نفترض إنه لسه مفعّل
            return { screen: 'activation', offline: true };
        }
    }
};

if (typeof module !== 'undefined') {
    module.exports = Session;
}
