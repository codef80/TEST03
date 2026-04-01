/**
 * ============================================================
 *  config.js — إعدادات مركزية لنظام وكالة ميديا
 *  يُضمَّن في كل صفحة قبل أي سكريبت آخر
 * ============================================================
 */

const APP_CONFIG = {

  /* ── رابط Google Apps Script API ── */
  API_URL: "https://script.google.com/macros/s/AKfycbymidZZCibho7iss45upPHl5btzBttYgDCPJmaDYQrm49a5q4zSvIb00WXsGPbGZU1_/exec",

  /* ── معلومات التطبيق ── */
  APP_NAME:    "وكالة ميديا",
  APP_VERSION: "4.0",
  APP_LOGO:    "https://i.ibb.co/N6TXzy3q/image.png",

  /* ── مسارات الصفحات ── */
  PAGES: {
    index:     "index.html",
    dashboard: "dashboard.html",
    bookings:  "bookings.html",
    finance:   "finance.html",
    projects:  "projects.html",
    settings:  "settings.html",
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
    systemCfg:   "media_systemConfig",   // كاش إعدادات النظام
    templates:   "media_templates",      // كاش قوالب الواتساب
  },

  /* ── مهلة الجلسة (بالدقائق) ── */
  SESSION_TIMEOUT: 480,  // 8 ساعات

  /* ── ترقيم الصفحات الافتراضي ── */
  DEFAULT_PAGE_SIZE: 15,
};


/* ============================================================
   طبقة API — GitHub Pages → Apps Script عبر HTTP GET
   ============================================================
   الآلية:
     fetch(API_URL?fn=X&p0=Y&p1=Z) → Apps Script doGet → JSON
   ============================================================ */
const API = {

  /**
   * استدعاء دالة Apps Script من GitHub Pages
   * @param {string} fn    اسم الدالة (يجب في ALLOWED_FUNCTIONS)
   * @param {...any} args  المعاملات — تُرسَل كـ p0, p1, p2, ...
   * @returns {Promise<any>}
   */
  run(fn, ...args) {
    const params = new URLSearchParams({ fn });
    args.forEach((a, i) => {
      params.append("p" + i,
        a === null || a === undefined ? ""
        : typeof a === "object"      ? JSON.stringify(a)
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
        if (data && data.success === false && data.error) {
          throw new Error(data.error);
        }
        return data;
      });
  },
};


/* ============================================================
   إدارة الجلسة
   ============================================================ */
const Session = {

  /** حفظ بيانات تسجيل الدخول */
  save(data) {
    const s = APP_CONFIG.STORAGE;
    localStorage.setItem(s.userName,    data.userName    || "");
    localStorage.setItem(s.userCode,    data.userCode    || "");
    localStorage.setItem(s.calendarId,  data.calendarId  || "");
    localStorage.setItem(s.permissions, JSON.stringify(data.permissions || {}));
    localStorage.setItem(s.loginTime,   new Date().toISOString());
  },

  /** قراءة بيانات الجلسة */
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

  /** هل المستخدم مسجَّل دخوله؟ */
  isLoggedIn() {
    const name = localStorage.getItem(APP_CONFIG.STORAGE.userName);
    if (!name) return false;

    // تحقق من انتهاء الجلسة
    const loginTime = localStorage.getItem(APP_CONFIG.STORAGE.loginTime);
    if (loginTime) {
      const diff = (Date.now() - new Date(loginTime).getTime()) / 60000;
      if (diff > APP_CONFIG.SESSION_TIMEOUT) { this.clear(); return false; }
    }
    return true;
  },

  /** تسجيل الخروج */
  clear() {
    Object.values(APP_CONFIG.STORAGE).forEach(k => localStorage.removeItem(k));
  },

  /** هل للمستخدم صلاحية الوصول لصفحة معينة؟ */
  canAccess(pageId) {
    const p = JSON.parse(localStorage.getItem(APP_CONFIG.STORAGE.permissions) || "{}");
    return p.allPages === true || (Array.isArray(p.pages) && p.pages.includes(pageId));
  },
};


/* ============================================================
   أدوات مساعدة عامة
   ============================================================ */
const Utils = {

  /** تنسيق الأرقام بفواصل */
  formatNum(n, decimals = 0) {
    return Number(n || 0).toLocaleString("ar-SA", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  },

  /** تطبيع رقم الهاتف السعودي */
  normalizePhone(raw) {
    let s = String(raw || "").replace(/\s/g, "").replace(/^\+/, "");
    if (s.startsWith("966") && s.length === 12) return s;
    if (s.startsWith("05")  && s.length === 10) return "966" + s.slice(1);
    if (s.startsWith("5")   && s.length === 9)  return "966" + s;
    if (s.startsWith("9660") && s.length === 13) return "966" + s.substring(4);
    return s;
  },

  /** بناء رابط واتساب */
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

  /** نسخ نص للحافظة */
  async copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { return false; }
  },

  /** تنزيل نص كملف */
  download(content, filename, mime = "text/plain;charset=utf-8") {
    const blob = new Blob([content], { type: mime });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  },

  /** تحويل CSV وتنزيله */
  downloadCSV(csvText, filename) {
    this.download("\uFEFF" + csvText, filename, "text/csv;charset=utf-8");
  },

  /** أسماء الأشهر بالعربية */
  MONTHS: [
    "", "يناير","فبراير","مارس","أبريل","مايو","يونيو",
    "يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"
  ],

  monthName(n) { return this.MONTHS[parseInt(n)] || n; },

  /** تاريخ اليوم بصيغة yyyy-MM-dd */
  today() {
    return new Date().toISOString().substring(0, 10);
  },

  /** فرق بالأيام بين تاريخين */
  daysDiff(from, to) {
    return Math.round((new Date(to) - new Date(from)) / 86400000);
  },

  /** الأيام المتبقية في الشهر الحالي */
  daysLeftInMonth() {
    const now  = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return last.getDate() - now.getDate();
  },
};


/* ============================================================
   مكون Toast (إشعارات خفيفة)
   ============================================================ */
const Toast = {
  _container: null,

  _init() {
    if (this._container) return;
    this._container = document.createElement("div");
    this._container.id = "toast-container";
    this._container.style.cssText =
      "position:fixed;top:1rem;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:.5rem;pointer-events:none;";
    document.body.appendChild(this._container);
  },

  show(message, type = "info", duration = 3000) {
    this._init();
    const colors = {
      success: "#059669", error: "#dc2626",
      warning: "#f97316", info:  "#0ea5e9",
    };
    const icons = {
      success: "✅", error: "❌", warning: "⚠️", info: "ℹ️",
    };
    const el = document.createElement("div");
    el.style.cssText = `
      background:${colors[type]||colors.info};color:#fff;
      padding:.65rem 1.2rem;border-radius:.75rem;
      font-family:'Tajawal',sans-serif;font-size:.9rem;font-weight:600;
      box-shadow:0 8px 24px rgba(0,0,0,.18);
      opacity:0;transform:translateY(-8px);transition:all .25s ease;
      pointer-events:auto;direction:rtl;
    `;
    el.textContent = `${icons[type]||""} ${message}`;
    this._container.appendChild(el);

    requestAnimationFrame(() => {
      el.style.opacity = "1";
      el.style.transform = "translateY(0)";
    });

    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transform = "translateY(-8px)";
      setTimeout(() => el.remove(), 300);
    }, duration);
  },

  success(msg, d) { this.show(msg, "success", d); },
  error(msg, d)   { this.show(msg, "error",   d); },
  warning(msg, d) { this.show(msg, "warning",  d); },
  info(msg, d)    { this.show(msg, "info",     d); },
};


/* ============================================================
   Spinner عام
   ============================================================ */
const Spinner = {
  show(title = "جاري التحميل...") {
    Swal.fire({ title, allowOutsideClick: false, didOpen: () => Swal.showLoading() });
  },
  hide() { Swal.close(); },
  async wrap(title, fn) {
    this.show(title);
    try { const r = await fn(); this.hide(); return r; }
    catch(e) { this.hide(); throw e; }
  },
};


/* ============================================================
   كاش بسيط في الذاكرة (يُعاد عند تحديث الصفحة)
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
   ترقيم الصفحات (Pagination) — مكوِّن قابل لإعادة الاستخدام
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
