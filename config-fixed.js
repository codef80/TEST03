/**
 * ============================================================
 *  config.js — وكالة ميديا — النسخة 5.0
 *  تحسينات:
 *    • DataStore: مخزن مركزي للبيانات مع Indexing
 *    • Background Loading: تحميل خلفي بدون تجميد الواجهة
 *    • getInitData: طلب واحد يجلب كل البيانات الأساسية
 *    • Cache: كاش ذكي مع TTL
 *    • fetch/CORS فقط — لا JSONP
 * ============================================================
 */

const APP_CONFIG = {

  /* ── رابط Google Apps Script API ── */
  API_URL: "https://script.google.com/macros/s/AKfycbymidZZCibho7iss45upPHl5btzBttYgDCPJmaDYQrm49a5q4zSvIb00WXsGPbGZU1_/exec",

  /* ── معلومات التطبيق ── */
  APP_NAME:    "وكالة ميديا",
  APP_VERSION: "5.0",
  APP_LOGO:    "https://i.ibb.co/N6TXzy3q/image.png",

  /* ── مسارات الصفحات ── */
  PAGES: {
    index:     "index.html",
    dashboard: "dashboard-fixed.html",
    bookings:  "bookings-fixed2.html",
    finance:   "finance-fixed.html",
    projects:  "projects-fixed.html",
    settings:  "settings-fixed.html",
    invoice:   "invoice-fixed.html",
    public:    "public.html",
    search:    "search.html",
  },

  /* ── مفاتيح localStorage ── */
  STORAGE: {
    userName:    "media_userName",
    userCode:    "media_userCode",
    calendarId:  "media_calendarId",
    permissions: "media_permissions",
    loginTime:   "media_loginTime",
    systemCfg:   "media_systemConfig",
    templates:   "media_templates",
  },

  /* ── مهلة الجلسة (بالدقائق) ── */
  SESSION_TIMEOUT: 480,

  /* ── ترقيم الصفحات الافتراضي ── */
  DEFAULT_PAGE_SIZE: 15,
};


/* ============================================================
   طبقة API — fetch/CORS المباشر (لا JSONP)
   الآلية: fetch(API_URL?fn=X&p0=Y) → Apps Script doGet → JSON
   ============================================================ */
const API = {

  /**
   * استدعاء دالة Apps Script
   * @param {string} fn   اسم الدالة
   * @param {...any} args المعاملات
   * @returns {Promise<any>}
   */
  run(fn, ...args) {
    const params = new URLSearchParams({ fn });
    args.forEach((a, i) => {
      params.append("p" + i,
        a === null || a === undefined ? ""
        : typeof a === "object" ? JSON.stringify(a)
        : String(a)
      );
    });

    const url = `${APP_CONFIG.API_URL}?${params.toString()}`;
    return fetch(url, { method: "GET", redirect: "follow" })
      .then(r => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(data => {
        if (data && data.success === false && data.error) throw new Error(data.error);
        return data;
      });
  },

  /**
   * استدعاء مع إعادة المحاولة تلقائياً عند الفشل
   * @param {string} fn
   * @param {number} retries  عدد المحاولات (افتراضي 2)
   * @param {...any} args
   */
  async runWithRetry(fn, retries = 2, ...args) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await this.run(fn, ...args);
      } catch(e) {
        if (attempt === retries) throw e;
        await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
      }
    }
  },
};


/* ============================================================
   DataStore — مخزن البيانات المركزي مع Indexing
   ============================================================
   يحتوي على:
     • البيانات المحمّلة
     • فهارس (Index) للبحث السريع
     • علامات تحميل لكل قسم
   ============================================================ */
const DataStore = {

  /* حالة التحميل */
  _loaded: {
    init:     false,   // getInitData
    bookings: false,   // getEvents
    finance:  false,   // getFinanceSummary
  },

  /* حالة التحميل الجاري */
  _loading: {
    init:     false,
    bookings: false,
    finance:  false,
  },

  /* البيانات */
  systemConfig: null,
  users:        [],
  templates:    [],
  dashStats:    null,
  bookings:     [],
  finance:      null,

  /* ── الفهارس (Indexes) للبحث السريع O(1) ── */
  _idx: {
    usersByCode:   {},   // { code: userObj }
    bookingsById:  {},   // { id: bookingObj }
    bookingsByDate:{},   // { "yyyy-MM-dd": [bookingObj] }
  },

  /**
   * بناء فهارس الحجوزات بعد تحميلها
   */
  _rebuildBookingsIndex() {
    const byId = {}, byDate = {};
    this.bookings.forEach(b => {
      if (b.id) byId[b.id] = b;
      const d = b.start || (b.extendedProps && b.extendedProps.date);
      if (d) {
        if (!byDate[d]) byDate[d] = [];
        byDate[d].push(b);
      }
    });
    this._idx.bookingsById   = byId;
    this._idx.bookingsByDate = byDate;
  },

  /**
   * بناء فهرس المستخدمين
   */
  _rebuildUsersIndex() {
    const byCode = {};
    this.users.forEach(u => {
      const code = String(u.code || "").trim();
      if (code) byCode[code] = u;
    });
    this._idx.usersByCode = byCode;
  },

  /* ── دوال بحث سريعة ── */

  /** البحث عن مستخدم بكوده O(1) */
  getUserByCode(code) {
    return this._idx.usersByCode[String(code || "").trim()] || null;
  },

  /** جلب حجز بـ id O(1) */
  getBookingById(id) {
    return this._idx.bookingsById[String(id || "")] || null;
  },

  /** جلب حجوزات يوم معين O(1) */
  getBookingsByDate(dateStr) {
    return this._idx.bookingsByDate[dateStr] || [];
  },

  /** أسماء المستخدمين كقائمة للـ Select */
  getUserOptions() {
    return this.users.map(u => ({
      code: u.code || "",
      name: u.name || "",
      mobile: u.mobile || u.phone || ""
    }));
  },

  /** إعدادات النظام — قوائم الحجوزات */
  getBookingTypes() {
    return (this.systemConfig && this.systemConfig.bookingTypes) || [];
  },

  getBookingExtraServices() {
    return (this.systemConfig && this.systemConfig.bookingExtraServices) || [];
  },

  getProjectSteps() {
    return (this.systemConfig && this.systemConfig.projectSteps) || [];
  },

  /** قوالب الواتساب بالنوع */
  getTemplatesByType(type) {
    return this.templates.filter(t => t.type === type);
  },
};


/* ============================================================
   AppLoader — مدير التحميل التدريجي في الخلفية
   ============================================================
   تسلسل التحميل:
     1) getInitData  → يملأ: systemConfig + users + templates + dashStats
                        (تحميل سريع، المستخدم يرى النتيجة فوراً)
     2) getEvents    → يُحمَّل في الخلفية بعد Init
     3) getFinanceSummary → يُحمَّل في الخلفية إذا احتاجته الصفحة
   ============================================================ */
const AppLoader = {

  /* callbacks لإشعار الصفحات بالتحميل */
  _callbacks: {
    onInitReady:     [],
    onBookingsReady: [],
    onFinanceReady:  [],
  },

  /**
   * تسجيل callback عند اكتمال تحميل معين
   * @param {'onInitReady'|'onBookingsReady'|'onFinanceReady'} event
   * @param {Function} fn
   */
  on(event, fn) {
    if (this._callbacks[event]) this._callbacks[event].push(fn);
    // إذا البيانات محمّلة مسبقاً، نستدعي الـ callback فوراً
    if (event === "onInitReady"     && DataStore._loaded.init)     fn(DataStore);
    if (event === "onBookingsReady" && DataStore._loaded.bookings) fn(DataStore.bookings);
    if (event === "onFinanceReady"  && DataStore._loaded.finance)  fn(DataStore.finance);
  },

  _emit(event, data) {
    (this._callbacks[event] || []).forEach(fn => { try { fn(data); } catch(e) { console.warn(e); } });
  },

  /**
   * 🚀 نقطة البداية الرئيسية — تُستدعى مرة واحدة عند بدء التطبيق
   * تحمّل البيانات الأساسية فوراً ثم تكمل الباقي في الخلفية
   */
  async start() {
    await this._loadInit();
    // تحميل الحجوزات في الخلفية بدون انتظار
    this._loadBookingsBackground();
  },

  /**
   * تحميل البيانات الأساسية (مرحلة 1)
   * يجب الانتظار حتى اكتمالها قبل عرض الواجهة
   */
  async _loadInit() {
    if (DataStore._loaded.init || DataStore._loading.init) return;
    DataStore._loading.init = true;

    try {
      const data = await API.runWithRetry("getInitData", 2);

      if (!data || !data.success) throw new Error(data?.error || "فشل getInitData");

      DataStore.systemConfig = data.systemConfig || null;
      DataStore.users        = data.users        || [];
      DataStore.templates    = data.templates    || [];
      DataStore.dashStats    = data.dashStats    || null;

      // كاش الإعدادات في localStorage
      if (DataStore.systemConfig) {
        try {
          localStorage.setItem(APP_CONFIG.STORAGE.systemCfg, JSON.stringify(DataStore.systemConfig));
        } catch(e) {}
      }
      if (DataStore.templates.length) {
        try {
          localStorage.setItem(APP_CONFIG.STORAGE.templates, JSON.stringify(DataStore.templates));
        } catch(e) {}
      }

      // بناء فهرس المستخدمين
      DataStore._rebuildUsersIndex();

      DataStore._loaded.init   = true;
      DataStore._loading.init  = false;

      this._emit("onInitReady", DataStore);

    } catch(e) {
      DataStore._loading.init = false;
      console.error("AppLoader._loadInit error:", e);

      // استعادة من localStorage كاحتياطي
      try {
        const cached = localStorage.getItem(APP_CONFIG.STORAGE.systemCfg);
        if (cached) DataStore.systemConfig = JSON.parse(cached);
        const cachedT = localStorage.getItem(APP_CONFIG.STORAGE.templates);
        if (cachedT) DataStore.templates = JSON.parse(cachedT);
      } catch(e2) {}

      DataStore._loaded.init = true; // نعتبرها محمّلة (بالبيانات الاحتياطية أو فارغة)
      this._emit("onInitReady", DataStore);
    }
  },

  /**
   * تحميل الحجوزات في الخلفية (مرحلة 2)
   * صامت — لا يقاطع المستخدم
   */
  async _loadBookingsBackground() {
    if (DataStore._loaded.bookings || DataStore._loading.bookings) return;
    DataStore._loading.bookings = true;

    try {
      const bookings = await API.run("getEvents");
      DataStore.bookings = Array.isArray(bookings) ? bookings : [];
      DataStore._rebuildBookingsIndex();
      DataStore._loaded.bookings   = true;
      DataStore._loading.bookings  = false;
      this._emit("onBookingsReady", DataStore.bookings);
    } catch(e) {
      DataStore._loading.bookings = false;
      console.warn("AppLoader._loadBookingsBackground error:", e);
    }
  },

  /**
   * تحميل بيانات المالية (تُستدعى عند فتح صفحة المالية)
   * @param {object} filter
   */
  async loadFinance(filter = {}) {
    DataStore._loading.finance = true;
    try {
      const data = await API.run("getFinanceSummary", filter);
      DataStore.finance         = data;
      DataStore._loaded.finance = true;
      DataStore._loading.finance = false;
      this._emit("onFinanceReady", data);
      return data;
    } catch(e) {
      DataStore._loading.finance = false;
      throw e;
    }
  },

  /**
   * إعادة تحميل الحجوزات (بعد إضافة/تعديل/حذف)
   * صامت في الخلفية
   */
  async refreshBookings() {
    DataStore._loaded.bookings  = false;
    await this._loadBookingsBackground();
  },

  /**
   * هل البيانات الأساسية جاهزة؟
   */
  isInitReady()     { return DataStore._loaded.init;     },
  isBookingsReady() { return DataStore._loaded.bookings; },
  isFinanceReady()  { return DataStore._loaded.finance;  },
};


/* ============================================================
   إدارة الجلسة
   ============================================================ */
const Session = {

  save(data) {
    const s = APP_CONFIG.STORAGE;
    localStorage.setItem(s.userName,    data.userName    || "");
    localStorage.setItem(s.userCode,    data.userCode    || "");
    localStorage.setItem(s.calendarId,  data.calendarId  || "");
    localStorage.setItem(s.permissions, JSON.stringify(data.permissions || {}));
    localStorage.setItem(s.loginTime,   new Date().toISOString());
  },

  get() {
    const s = APP_CONFIG.STORAGE;
    return {
      userName:    localStorage.getItem(s.userName)    || "",
      userCode:    localStorage.getItem(s.userCode)    || "",
      calendarId:  localStorage.getItem(s.calendarId)  || "",
      permissions: JSON.parse(localStorage.getItem(s.permissions) || "{}"),
      loginTime:   localStorage.getItem(s.loginTime)   || "",
    };
  },

  isLoggedIn() {
    const name = localStorage.getItem(APP_CONFIG.STORAGE.userName);
    if (!name) return false;
    const loginTime = localStorage.getItem(APP_CONFIG.STORAGE.loginTime);
    if (loginTime) {
      const diff = (Date.now() - new Date(loginTime).getTime()) / 60000;
      if (diff > APP_CONFIG.SESSION_TIMEOUT) { this.clear(); return false; }
    }
    return true;
  },

  clear() {
    Object.values(APP_CONFIG.STORAGE).forEach(k => localStorage.removeItem(k));
  },

  canAccess(pageId) {
    const p = JSON.parse(localStorage.getItem(APP_CONFIG.STORAGE.permissions) || "{}");
    return p.allPages === true || (Array.isArray(p.pages) && p.pages.includes(pageId));
  },
};


/* ============================================================
   أدوات مساعدة عامة
   ============================================================ */
const Utils = {

  /** تنسيق الأرقام بأرقام إنجليزية */
  formatNum(n, decimals = 0) {
    return Number(n || 0).toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  },

  /** تطبيع رقم هاتف سعودي */
  normalizePhone(raw) {
    let s = String(raw || "").replace(/\s/g, "").replace(/^\+/, "").replace(/^'/, "");
    if (s.startsWith("966") && s.length === 12) return s;
    if (s.startsWith("05")  && s.length === 10) return "966" + s.slice(1);
    if (s.startsWith("5")   && s.length === 9)  return "966" + s;
    if (s.startsWith("9660") && s.length === 13) return "966" + s.substring(4);
    return s;
  },

  waLink(phone, text) {
    return `https://wa.me/${this.normalizePhone(phone)}?text=${encodeURIComponent(text)}`;
  },

  /** تهريب HTML */
  esc(t) {
    return String(t ?? "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;")
      .replace(/'/g,"&#039;");
  },

  async copy(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch { return false; }
  },

  download(content, filename, mime = "text/plain;charset=utf-8") {
    const blob = new Blob([content], { type: mime });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement("a"), { href: url, download: filename });
    a.click();
    URL.revokeObjectURL(url);
  },

  downloadCSV(csvText, filename) {
    this.download("\uFEFF" + csvText, filename, "text/csv;charset=utf-8");
  },

  MONTHS: ["","يناير","فبراير","مارس","أبريل","مايو","يونيو",
            "يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"],

  monthName(n) { return this.MONTHS[parseInt(n)] || n; },

  today() { return new Date().toISOString().substring(0, 10); },

  daysDiff(from, to) { return Math.round((new Date(to) - new Date(from)) / 86400000); },

  daysLeftInMonth() {
    const now = new Date(), last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return last.getDate() - now.getDate();
  },

  /** تحقق من انتهاء الجلسة وإعادة التوجيه */
  guardSession() {
    const userName = localStorage.getItem(APP_CONFIG.STORAGE.userName);
    if (!userName) {
      const isInIframe = window.self !== window.top;
      if (isInIframe) { window.parent.postMessage({ type: "logout" }, "*"); return false; }
      window.location.href = APP_CONFIG.PAGES.index || "index.html";
      return false;
    }
    const loginTime = localStorage.getItem(APP_CONFIG.STORAGE.loginTime);
    if (loginTime) {
      const diff = (Date.now() - new Date(loginTime).getTime()) / 60000;
      if (diff > APP_CONFIG.SESSION_TIMEOUT) {
        Session.clear();
        const isInIframe = window.self !== window.top;
        if (isInIframe) window.parent.postMessage({ type: "logout" }, "*");
        else window.location.href = APP_CONFIG.PAGES.index || "index.html";
        return false;
      }
    }
    return true;
  },
};


/* ============================================================
   Toast — إشعارات خفيفة
   ============================================================ */
const Toast = {
  _container: null,

  _init() {
    if (this._container) return;
    this._container = document.createElement("div");
    this._container.id = "toast-container";
    this._container.style.cssText =
      "position:fixed;top:1rem;left:50%;transform:translateX(-50%);z-index:9999;" +
      "display:flex;flex-direction:column;gap:.5rem;pointer-events:none;";
    document.body.appendChild(this._container);
  },

  show(message, type = "info", duration = 3000) {
    this._init();
    const colors = { success:"#059669", error:"#dc2626", warning:"#f97316", info:"#0ea5e9" };
    const icons  = { success:"✅", error:"❌", warning:"⚠️", info:"ℹ️" };
    const el = document.createElement("div");
    el.style.cssText =
      `background:${colors[type]||colors.info};color:#fff;padding:.65rem 1.2rem;` +
      `border-radius:.75rem;font-family:'Tajawal',sans-serif;font-size:.9rem;font-weight:600;` +
      `box-shadow:0 8px 24px rgba(0,0,0,.18);opacity:0;transform:translateY(-8px);` +
      `transition:all .25s ease;pointer-events:auto;direction:rtl;`;
    el.textContent = `${icons[type]||""} ${message}`;
    this._container.appendChild(el);
    requestAnimationFrame(() => {
      el.style.opacity = "1"; el.style.transform = "translateY(0)";
    });
    setTimeout(() => {
      el.style.opacity = "0"; el.style.transform = "translateY(-8px)";
      setTimeout(() => el.remove(), 300);
    }, duration);
  },

  success(msg, d) { this.show(msg, "success", d); },
  error(msg, d)   { this.show(msg, "error",   d); },
  warning(msg, d) { this.show(msg, "warning",  d); },
  info(msg, d)    { this.show(msg, "info",     d); },
};


/* ============================================================
   Spinner — مؤشر تحميل
   ============================================================ */
const Spinner = {
  show(title = "جاري التحميل...") {
    if (typeof Swal !== "undefined") {
      Swal.fire({ title, allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    }
  },
  hide() {
    if (typeof Swal !== "undefined") Swal.close();
  },
  async wrap(title, fn) {
    this.show(title);
    try { const r = await fn(); this.hide(); return r; }
    catch(e) { this.hide(); throw e; }
  },
};


/* ============================================================
   Cache — كاش بسيط في الذاكرة
   ============================================================ */
const Cache = {
  _store: {},

  set(key, val, ttlSeconds = 300) {
    this._store[key] = { val, exp: Date.now() + ttlSeconds * 1000 };
  },

  get(key) {
    const entry = this._store[key];
    if (!entry || Date.now() > entry.exp) { delete this._store[key]; return null; }
    return entry.val;
  },

  clear(key) {
    if (key) delete this._store[key];
    else this._store = {};
  },
};


/* ============================================================
   ترقيم الصفحات
   ============================================================ */
function renderPagination(containerId, currentPage, totalPages, onPageClick) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = "";
  if (totalPages <= 1) return;

  const pages = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (currentPage > 3) pages.push("...");
    for (let i = Math.max(2, currentPage-1); i <= Math.min(totalPages-1, currentPage+1); i++) pages.push(i);
    if (currentPage < totalPages - 2) pages.push("...");
    pages.push(totalPages);
  }

  pages.forEach(p => {
    const li = document.createElement("li");
    li.className = "page-item" + (p === currentPage ? " active" : "") + (p === "..." ? " disabled" : "");
    li.innerHTML = `<a class="page-link" href="#">${p}</a>`;
    if (p !== "..." && p !== currentPage) {
      li.querySelector("a").addEventListener("click", e => { e.preventDefault(); onPageClick(p); });
    }
    el.appendChild(li);
  });
}


/* ============================================================
   دالة مساعدة موحّدة للصفحات — guardSession + AppLoader.start
   ============================================================
   استخدمها في كل صفحة:
     document.addEventListener('DOMContentLoaded', initPage);
     async function initPage() {
       if (!await PageInit.start()) return;  // الجلسة منتهية
       AppLoader.on('onInitReady', ds => {
         // ملء قوائم الإعدادات، الواجهة الأساسية
       });
       AppLoader.on('onBookingsReady', bookings => {
         // تحديث التقويم / الجدول
       });
     }
   ============================================================ */
const PageInit = {
  /**
   * يتحقق من الجلسة ثم يشغل AppLoader.start()
   * @returns {Promise<boolean>} — false إذا كانت الجلسة منتهية
   */
  async start() {
    if (!Utils.guardSession()) return false;
    await AppLoader.start();
    return true;
  },
};
