const rateLimit = require('express-rate-limit');

// يمنع محاولات تخمين كود التفعيل بشكل متكرر
const activationLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 دقائق
    max: 10, // 10 محاولات كحد أقصى لكل IP خلال المدة
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many attempts. Please try again later.' }
});

// فحص دوري لحالة اللايسنس (بيتنادى كل ما التطبيق يفتح / بشكل دوري وهو شغال)
// مسموح بمعدل أعلى من الـ activation لأنه بيحصل تلقائي في الخلفية
const statusLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 دقائق
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many status checks. Please try again shortly.' }
});

// حماية إضافية لمسارات الأدمن الحساسة (توليد أكواد، إلغاء رخص...)
const adminLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many admin requests. Please slow down.' }
});

module.exports = { activationLimiter, statusLimiter, adminLimiter };
