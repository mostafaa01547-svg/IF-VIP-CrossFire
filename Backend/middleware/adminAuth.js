// حماية بسيطة لمسارات الأدمن (توليد أكواد، إلغاء/تعليق رخصة، إدارة الأجهزة...)
// طلب لازم يبعت الهيدر: x-admin-key: <ADMIN_API_KEY>
// دي حماية أساسية فقط - لو هتبني Admin Panel حقيقي بواجهة، الأفضل تستبدلها لاحقاً
// بنظام حسابات إداريين + MFA بدل مفتاح ثابت واحد.
function requireAdmin(req, res, next) {
    const adminKey = req.headers['x-admin-key'];

    if (!process.env.ADMIN_API_KEY) {
        console.error('[adminAuth] ADMIN_API_KEY is not set in the backend .env — admin routes are locked until it is configured.');
        return res.status(503).json({ success: false, message: 'Admin access is not configured on this server.' });
    }

    if (!adminKey || adminKey !== process.env.ADMIN_API_KEY) {
        return res.status(401).json({ success: false, message: 'Unauthorized.' });
    }

    next();
}

module.exports = { requireAdmin };
