import { useState, useRef, useEffect } from "react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

// Vercel / .env: VITE_SHEETS_URL=https://script.google.com/macros/s/.../exec
const SHEETS_URL =
  import.meta.env.VITE_SHEETS_URL ||
  "https://script.google.com/macros/s/AKfycbxaKwZDW-B6OHkPlb4dp8VBRnEK9BtETxQOR9GvwpBvmqIpdoTxfg13SE1-9Bc34qJe3A/exec";

const CATEGORIES = {
  gelir: [
    { id: "maas", label: "Maaş", icon: "💼", color: "#34C759" },
    { id: "uber_gelir", label: "Uber Geliri", icon: "🚗", color: "#E65100" },
    { id: "freelance", label: "Freelance", icon: "💻", color: "#30D158" },
    { id: "kira_geliri", label: "Kira Geliri", icon: "🏠", color: "#32D74B" },
    { id: "yatirim", label: "Yatırım", icon: "📈", color: "#4CD964" },
    { id: "diger_gelir", label: "Diğer Gelir", icon: "💰", color: "#28CD41" },
  ],
  gider: [
    { id: "market", label: "Market", icon: "🛒", color: "#FF453A" },
    { id: "faturalar", label: "Faturalar", icon: "⚡", color: "#FF6B35" },
    { id: "ulasim", label: "Ulaşım", icon: "🚙", color: "#FF9F0A" },
    { id: "saglik", label: "Sağlık", icon: "💊", color: "#FF375F" },
    { id: "eglence", label: "Eğlence", icon: "🎬", color: "#BF5AF2" },
    { id: "giyim", label: "Giyim", icon: "👗", color: "#FF6B6B" },
    { id: "yemek", label: "Yemek/Restoran", icon: "🍽️", color: "#FF8C42" },
    { id: "egitim", label: "Eğitim", icon: "📚", color: "#0A84FF" },
    { id: "kira", label: "Kira", icon: "🏡", color: "#5E5CE6" },
    { id: "uber_gider", label: "Uber Gideri", icon: "🚗", color: "#E65100" },
    { id: "diger_gider", label: "Diğer Gider", icon: "📦", color: "#98989D" },
  ],
};

const MONTHS = ["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"];
const EMPTY_FORM = { type: "gider", category: "market", amount: "", desc: "", date: new Date().toISOString().split("T")[0], isUber: false };

function fmt(n) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n || 0);
}

function getCat(type, id) {
  return CATEGORIES[type]?.find(c => c.id === id) || { label: id, icon: "📌", color: "#888" };
}

function txTypeLabel(tx) {
  return tx.type === "gelir" ? "Gelir" : tx.type === "gider" ? "Gider" : "";
}

function capitalizeWordsTr(s) {
  if (!s || typeof s !== "string") return "";
  return s.split(/\s+/).map((w) => {
    if (!w) return w;
    const lower = w.toLocaleLowerCase("tr-TR");
    return lower.charAt(0).toLocaleUpperCase("tr-TR") + lower.slice(1);
  }).join(" ");
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880; osc.type = "sine";
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.3);
  } catch(e) {}
}

function parseUberDate(day, mon, year) {
  const months = {
    oca: 1, ocak: 1, jan: 1,
    sub: 2, şub: 2, subat: 2, şubat: 2, feb: 2,
    mar: 3,
    nis: 4, nisan: 4, apr: 4,
    may: 5,
    haz: 6, haziran: 6, jun: 6,
    tem: 7, temmuz: 7, jul: 7,
    agu: 8, ağu: 8, agustos: 8, ağustos: 8, aug: 8,
    eyl: 9, eylul: 9, eylül: 9, sep: 9,
    eki: 10, ekim: 10, oct: 10,
    kas: 11, kasim: 11, kasım: 11, nov: 11,
    ara: 12, aralik: 12, aralık: 12, dec: 12
  };
  const key = String(mon || "").toLowerCase().trim();
  const m = months[key];
  const d = Number(day);
  const y = Number(year);
  if (!m || !d || !y) return "";
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseMoneyText(raw) {
  if (!raw) return 0;
  let str = String(raw).replace(/[^\d.,-]/g, "");
  if (str.includes(".") && str.includes(",")) {
    const lastDot = str.lastIndexOf(".");
    const lastComma = str.lastIndexOf(",");
    if (lastDot > lastComma) return parseFloat(str.replace(/,/g, "")) || 0;
    return parseFloat(str.replace(/\./g, "").replace(",", ".")) || 0;
  }
  if (str.includes(",")) {
    const parts = str.split(",");
    if (parts[1] && parts[1].length === 3) return parseFloat(str.replace(/,/g, "")) || 0;
    return parseFloat(str.replace(",", ".")) || 0;
  }
  return parseFloat(str) || 0;
}

function extractMoneyByLabel(text, labelRegex) {
  const m = text.match(new RegExp(`${labelRegex}[\\s\\S]{0,80}?CA\\$\\s*([\\-\\d.,]+)`, "i"));
  return m ? parseMoneyText(m[1]) : 0;
}

function parseUberSummaryFromText(text) {
  const periodMatch = text.match(/(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü]{3,})\s+(\d{4})\s+\d{2}\s*-\s*(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü]{3,})\s+(\d{4})\s+\d{2}/i);
  const period_start = periodMatch ? parseUberDate(periodMatch[1], periodMatch[2], periodMatch[3]) : "";
  const period_end = periodMatch ? parseUberDate(periodMatch[4], periodMatch[5], periodMatch[6]) : "";

  const earningsMain = extractMoneyByLabel(text, "Kazançlarınız(?!\\s*dökümü)");
  const expenses = extractMoneyByLabel(text, "Para\\s+İadeleri\\s+ve\\s+Giderler(?!\\s*dökümü)");
  const prevWeek = extractMoneyByLabel(text, "Önceki\\s+haftalardaki\\s+etkinlikler");
  const payments = extractMoneyByLabel(text, "Ödemeler");

  const earnings = Math.round((earningsMain + prevWeek) * 100) / 100;
  const total = payments > 0 ? payments : Math.round((earnings + expenses) * 100) / 100;
  return { earnings, expenses, total, period_start, period_end };
}

async function parseUberPdfWithPdfJs(file) {
  const pdfjs = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs");
  if (pdfjs?.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
  }
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const maxPages = Math.min(pdf.numPages, 4);
  let combined = "";
  for (let p = 1; p <= maxPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    combined += "\n" + (content.items || []).map((i) => i.str || "").join("\n");
  }
  const parsed = parseUberSummaryFromText(combined);
  const mainOnly = extractMoneyByLabel(combined, "Kazançlarınız(?!\\s*dökümü)");
  if (mainOnly <= 0 && extractMoneyByLabel(combined, "Ödemeler") <= 0) {
    throw new Error("Uber özeti PDF metninde bulunamadı (sayfa metni boş veya farklı format)");
  }
  return parsed;
}

function normalizeTxDate(d) {
  if (d == null || d === "") return "";
  const s = String(d);
  return s.includes("T") ? s.slice(0, 10) : s;
}

/** Ay/yıl filtresi — ISO tarih parse (timezone kaynaklı boş grafik/özet önlenir) */
function txMonthYear(tx) {
  const raw = normalizeTxDate(tx?.date);
  if (!raw || typeof raw !== "string") return null;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (!y || mo < 0 || mo > 11 || !d) return null;
  return { month: mo, year: y };
}

function getAISuggestions(transactions) {
  const suggestions = [];
  const now = new Date();
  const thisMonth = transactions.filter((t) => {
    const my = txMonthYear(t);
    return my && my.month === now.getMonth() && my.year === now.getFullYear();
  });
  const gelir = thisMonth.filter(t => t.type === "gelir").reduce((s,t) => s+t.amount, 0);
  const gider = thisMonth.filter(t => t.type === "gider").reduce((s,t) => s+t.amount, 0);
  const balance = gelir - gider;
  const byCat = {};
  thisMonth.filter(t => t.type === "gider").forEach(t => { byCat[t.category] = (byCat[t.category]||0) + t.amount; });
  if (gider > gelir * 0.8) suggestions.push({ type: "warning", icon: "⚠️", text: "Bu ay giderleriniz gelirinizin %80'ini aştı. Tasarruf planı oluşturun." });
  if (byCat["yemek"] > gelir * 0.15) suggestions.push({ type: "tip", icon: "🍽️", text: `Yemek harcamaları (${fmt(byCat["yemek"])}) yüksek. Evde yemek yaparak tasarruf edebilirsiniz.` });
  if (balance > 0) suggestions.push({ type: "positive", icon: "🎯", text: `Aylık ${fmt(balance)} fazlanızı yatırıma yönlendirin.` });
  if (balance > 3000) suggestions.push({ type: "positive", icon: "📈", text: "Gelirinizin %10'unu acil fon için biriktirin." });
  return suggestions;
}

function sheetRowToTx(t) {
  const id = t.id;
  return {
    id: typeof id === "number" ? id : Number(id) || id,
    type: t.type || "",
    category: t.category || "",
    amount: Number(t.amount || 0),
    desc: t.desc || "",
    date: normalizeTxDate(t.date),
    isUber: !!t.isUber,
    createdAt: t.createdAt || "",
    updatedAt: t.updatedAt || "",
    deleted: !!t.deleted,
  };
}

function mergeTxFromSheet(prev, remoteList) {
  const byId = {};
  (prev || []).forEach((t) => {
    if (t?.id == null || t.deleted) return;
    byId[String(t.id)] = { ...t, deleted: !!t.deleted };
  });
  (remoteList || []).forEach((raw) => {
    if (raw && raw.deleted) return;
    const t = sheetRowToTx(raw);
    const id = String(t.id);
    if (t.deleted) {
      delete byId[id];
      return;
    }
    const p = byId[id];
    const pTs = new Date(p?.updatedAt || p?.createdAt || 0).getTime();
    const rTs = new Date(t.updatedAt || t.createdAt || 0).getTime();
    if (!p || (isFinite(rTs) && isFinite(pTs) && rTs >= pTs)) byId[id] = { ...t, deleted: false };
  });
  return Object.values(byId);
}

export default function FinansApp() {
  const LS_KEY = "butcem_v3";
  const [transactions, setTransactions] = useState(() => {
    try {
      const s = localStorage.getItem(LS_KEY);
      if (s !== null && s !== "") return JSON.parse(s);
      return [];
    } catch {
      return [];
    }
  });
  const [tab, setTab] = useState("dashboard");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({...EMPTY_FORM});
  const [receiptPreview, setReceiptPreview] = useState(null);
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth());
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());
  const [deleteId, setDeleteId] = useState(null);
  const [resetStep, setResetStep] = useState(0);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [notification, setNotification] = useState(null);
  const [uberLoading, setUberLoading] = useState(false);
  const [showUberModal, setShowUberModal] = useState(false);
  const [uberResult, setUberResult] = useState(null);
  const [uberImportIsUber, setUberImportIsUber] = useState(true);
  const [showPdfUberChoice, setShowPdfUberChoice] = useState(false);
  const [pendingPdfFile, setPendingPdfFile] = useState(null);
  const [pullingSheets, setPullingSheets] = useState(false);
  const fileRef = useRef();
  const uberFileRef = useRef();

  // Save to localStorage
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(transactions)); } catch {}
  }, [transactions]);

  // Sync to Sheets (debounced 1.5s) — tum kayitlar + silinenler (deleted:true) ki Sheet'ten satir silinsin
  useEffect(() => {
    if (!SHEETS_URL || !String(SHEETS_URL).includes("script.google.com")) return;
    const t = setTimeout(() => {
      const alive = transactions.filter((tx) => !tx.deleted);
      const uberTransactions = alive.filter((tx) => tx.isUber);
      const personalTransactions = alive.filter((tx) => !tx.isUber);
      fetch(SHEETS_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sync",
          transactions,
          uberTransactions,
          personalTransactions,
          sheetTargets: {
            all: "Tüm İşlemler",
            uber: "Uber İşlemler",
            personal: "İşlemler",
          },
        }),
      }).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [transactions]);

  const showNotif = (msg, color = "#34C759") => { setNotification({ msg, color }); setTimeout(() => setNotification(null), 3000); };

  const pullFromSheet = async () => {
    if (!SHEETS_URL || !String(SHEETS_URL).includes("script.google.com")) {
      showNotif("Sheet URL tanımlı değil", "#FF453A");
      return;
    }
    setPullingSheets(true);
    try {
      const res = await fetch(`${SHEETS_URL}?_=${Date.now()}`);
      if (!res.ok) throw new Error("Sunucu yanıt vermedi");
      const data = await res.json();
      if (!Array.isArray(data.transactions)) throw new Error("transactions yok");
      setTransactions((prev) => mergeTxFromSheet(prev, data.transactions));
      showNotif("Sheet'ten yüklendi", "#34C759");
    } catch (e) {
      showNotif("Sheet çekilemedi: " + (e?.message || ""), "#FF453A");
    }
    setPullingSheets(false);
  };

  const handleAdd = () => {
    const amt = parseFloat(String(form.amount).replace(",",".").replace("$",""));
    if (isNaN(amt) || amt <= 0) { showNotif("Geçerli bir tutar girin!", "#FF453A"); return; }
    const isUber = form.isUber || form.category === "uber_gelir" || form.category === "uber_gider";
    const nowIso = new Date().toISOString();
    const newTx = { id: Date.now(), type: form.type, category: form.category, amount: amt, desc: form.desc || getCat(form.type, form.category).label, date: form.date, isUber, createdAt: nowIso, updatedAt: nowIso, deleted: false };
    setTransactions(prev => [newTx, ...prev]);
    setShowModal(false);
    setReceiptPreview(null);
    setForm({...EMPTY_FORM});
    showNotif(`${form.type === "gelir" ? "💚 Gelir" : "🔴 Gider"} eklendi ✓`);
  };

  const handleDelete = (id) => {
    const nowIso = new Date().toISOString();
    setTransactions((prev) =>
      prev.map((t) => (String(t.id) === String(id) ? { ...t, deleted: true, updatedAt: nowIso } : t))
    );
    setDeleteId(null);
    showNotif("Silindi", "#FF453A");
  };

  const handleReset = () => {
    setTransactions([]);
    try {
      localStorage.removeItem("butcem_v2");
      localStorage.removeItem(LS_KEY);
    } catch {}
    setResetStep(0);
    showNotif("Tüm veriler silindi!", "#FF453A");
  };

  const handleReceiptUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    let mediaType = file.type || "image/jpeg";
    if (!["image/jpeg","image/png","image/gif","image/webp"].includes(mediaType)) mediaType = "image/jpeg";
    const reader = new FileReader();
    reader.onload = async (ev) => {
      setReceiptPreview(ev.target.result);
      setOcrLoading(true);
      try {
        const base64 = ev.target.result.split(",")[1];
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${import.meta.env.VITE_GEMINI_API_KEY}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: mediaType, data: base64 } }, { text: `Fisteki toplam tutari bul. Sadece JSON yaz: {"amount":36.73,"desc":"Canadian Tire","category":"market","date":"2026-03-22"}\nKategori: market, yemek, faturalar, ulasim, saglik, eglence, giyim, egitim, kira, diger_gider\nBugun: ${new Date().toISOString().split("T")[0]}\nSADECE JSON, baska hicbir sey yazma.` }] }], generationConfig: { temperature: 0, maxOutputTokens: 1000 } })
        });
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const start = text.indexOf("{"); const end = text.lastIndexOf("}");
        if (start === -1) throw new Error("JSON yok");
        const parsed = JSON.parse(text.substring(start, end+1));
        if (!parsed.amount || parsed.amount <= 0) throw new Error("Tutar yok");
        setForm(f => ({ ...f, type: "gider", amount: String(parsed.amount), desc: parsed.desc || "", category: parsed.category || "diger_gider", date: parsed.date || f.date }));
        playBeep();
        showNotif("✅ Fiş okundu! Kontrol et ve ekle.");
      } catch { showNotif("Fiş okunamadı, manuel gir", "#FF9F0A"); }
      setOcrLoading(false);
    };
    reader.readAsDataURL(file);
  };

  const pickPdfFile = (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const isPdf = (file.type || "").toLowerCase().includes("pdf") || /\.pdf$/i.test(file.name || "");
    if (!isPdf) {
      showNotif("Lütfen PDF seçin.", "#FF453A");
      return;
    }
    setPendingPdfFile(file);
    setShowPdfUberChoice(true);
  };

  const startPdfParse = async (isUberWork) => {
    const file = pendingPdfFile;
    setShowPdfUberChoice(false);
    setPendingPdfFile(null);
    if (!file) return;
    setUberImportIsUber(!!isUberWork);
    setUberLoading(true);
    setShowUberModal(true);
    setUberResult(null);
    try {
      try {
        const local = await parseUberPdfWithPdfJs(file);
        const today = new Date().toISOString().split("T")[0];
        setUberResult({
          earnings: local.earnings,
          expenses: local.expenses,
          total: local.total,
          period_start: local.period_start || today,
          period_end: local.period_end || today,
        });
        setUberLoading(false);
        return;
      } catch (localErr) {
        console.warn("pdf.js parse:", localErr?.message);
      }

      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      if (!apiKey) throw new Error("Yerel okuma başarısız; VITE_GEMINI_API_KEY yok.");

      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      const base64 = btoa(binary);

      const models = ["gemini-2.0-flash", "gemini-1.5-flash"];
      let rawText = "";
      for (const model of models) {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { inline_data: { mime_type: "application/pdf", data: base64 } },
                  { text: `Uber haftalik ekstre. Sadece su satirlar:
KAZANCLAR:945.95
ONCEKI_HAFTA:4.92
GIDERLER:66.27
ODEMELER:1017.14
DONEM_BASLANGIC:2026-03-16
DONEM_BITIS:2026-03-23
Baska metin yok.` }
                ]
              }],
              generationConfig: { temperature: 0, maxOutputTokens: 400 }
            })
          }
        );
        const data = await res.json();
        if (!res.ok) continue;
        rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (rawText) break;
      }
      if (!rawText) throw new Error("Gemini yanıt vermedi");

      const parseNum = (str) => {
        if (!str) return 0;
        return parseMoneyText(str);
      };
      const earnM = rawText.match(/KAZANCLAR\s*:\s*([\d.,]+)/i);
      const prevM = rawText.match(/ONCEKI_HAFTA\s*:\s*([\d.,]+)/i);
      const giderM = rawText.match(/GIDERLER\s*:\s*([\d.,]+)/i);
      const odeM = rawText.match(/ODEMELER\s*:\s*([\d.,]+)/i);
      const sM = rawText.match(/DONEM_BASLANGIC\s*:\s*(\d{4}-\d{2}-\d{2})/i);
      const eM = rawText.match(/DONEM_BITIS\s*:\s*(\d{4}-\d{2}-\d{2})/i);

      const main = earnM ? parseNum(earnM[1]) : 0;
      const prevW = prevM ? parseNum(prevM[1]) : 0;
      let earnings = Math.round((main + prevW) * 100) / 100;
      let expenses = giderM ? parseNum(giderM[1]) : 0;
      let total = odeM ? parseNum(odeM[1]) : Math.round((earnings + expenses) * 100) / 100;
      if (expenses <= 0 && total > earnings) expenses = Math.round((total - earnings) * 100) / 100;

      const period_start = sM ? sM[1] : new Date().toISOString().split("T")[0];
      const period_end = eM ? eM[1] : new Date().toISOString().split("T")[0];

      if (earnings === 0) throw new Error("Kazanç bulunamadı");
      setUberResult({ earnings, expenses, total, period_start, period_end });
    } catch (err) {
      console.error("PDF hatası:", err?.message);
      showNotif("PDF okunamadı: " + (err?.message || "Bilinmeyen"), "#FF453A");
      setShowUberModal(false);
    }
    setUberLoading(false);
  };

  const confirmUberImport = (result, isUber = true) => {
    const newTxs = [];
    const nowIso = new Date().toISOString();
    const catGelir = isUber ? "uber_gelir" : "diger_gelir";
    const catGider = isUber ? "uber_gider" : "diger_gider";
    const tag = isUber ? "🚗 Uber" : "📄 PDF";
    if (result.earnings > 0) {
      newTxs.push({
        id: Date.now(),
        type: "gelir",
        category: catGelir,
        amount: result.earnings,
        desc: `${tag} Kazanç (${result.period_start} - ${result.period_end})`,
        date: result.period_end,
        isUber,
        createdAt: nowIso,
        updatedAt: nowIso,
        deleted: false,
      });
    }
    if (result.expenses > 0) {
      newTxs.push({
        id: Date.now() + 1,
        type: "gider",
        category: catGider,
        amount: result.expenses,
        desc: `${tag} Giderler (${result.period_start} - ${result.period_end})`,
        date: result.period_end,
        isUber,
        createdAt: nowIso,
        updatedAt: nowIso,
        deleted: false,
      });
    }
    setTransactions((prev) => [...newTxs, ...prev]);
    setShowUberModal(false);
    setUberResult(null);
    showNotif(isUber ? "Uber verisi içe aktarıldı! ✓" : "PDF verisi (özel) içe aktarıldı! ✓");
  };

  const activeTxList = transactions.filter((t) => !t.deleted);
  const filteredTx = activeTxList.filter((t) => {
    const my = txMonthYear(t);
    return my && my.month === filterMonth && my.year === filterYear;
  });
  const filteredPersonalTx = filteredTx.filter((t) => !t.isUber);
  const filteredUberTx = filteredTx.filter((t) => t.isUber);
  const totalGelir = filteredTx.filter(t => t.type==="gelir").reduce((s,t) => s+t.amount, 0);
  const totalGider = filteredTx.filter(t => t.type==="gider").reduce((s,t) => s+t.amount, 0);
  const balance = totalGelir - totalGider;

  const giderByCat = {}; filteredTx.filter(t => t.type==="gider").forEach(t => { const cat = getCat("gider",t.category); if (!giderByCat[t.category]) giderByCat[t.category] = { name:cat.label, value:0, color:cat.color, icon:cat.icon }; giderByCat[t.category].value += t.amount; });
  const gelirByCat = {}; filteredTx.filter(t => t.type==="gelir").forEach(t => { const cat = getCat("gelir",t.category); if (!gelirByCat[t.category]) gelirByCat[t.category] = { name:cat.label, value:0, color:cat.color, icon:cat.icon }; gelirByCat[t.category].value += t.amount; });

  const monthlyData = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (5 - i));
    const m = d.getMonth();
    const y = d.getFullYear();
    const txs = activeTxList.filter((t) => {
      const my = txMonthYear(t);
      return my && my.month === m && my.year === y;
    });
    const Gelir = txs.filter((t) => t.type === "gelir").reduce((s, t) => s + t.amount, 0);
    const Gider = txs.filter((t) => t.type === "gider").reduce((s, t) => s + t.amount, 0);
    return { name: MONTHS[m], monthIndex: m, year: y, Gelir, Gider, Net: Gelir - Gider };
  });

  const suggestions = getAISuggestions(activeTxList);
  const pieGiderData = Object.values(giderByCat);
  const pieGelirData = Object.values(gelirByCat);

  const openAdd = (type) => { setForm({...EMPTY_FORM, type, category: type==="gelir"?"maas":"market"}); setReceiptPreview(null); setShowModal(true); };

  return (
    <div style={{minHeight:"100vh",background:"#000",color:"#fff",fontFamily:"'SF Pro Display',-apple-system,sans-serif",maxWidth:430,margin:"0 auto",position:"relative"}}>

      {notification && <div style={{position:"fixed",top:60,left:"50%",transform:"translateX(-50%)",background:notification.color,color:"#fff",padding:"10px 24px",borderRadius:20,fontSize:14,fontWeight:600,zIndex:9999,boxShadow:"0 4px 20px rgba(0,0,0,0.4)",whiteSpace:"nowrap"}}>{notification.msg}</div>}

      {/* Header */}
      <div style={{padding:"56px 20px 0",background:"linear-gradient(180deg,#1C1C1E 0%,#000 100%)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <div><div style={{fontSize:13,color:"#8E8E93"}}>Hoş geldin 👋</div><div style={{fontSize:22,fontWeight:700}}>Bütçem</div></div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <button type="button" onClick={pullFromSheet} disabled={pullingSheets} title="Google Sheet'ten verileri çek" style={{background:"#2C2C2E",border:"none",color:"#0A84FF",borderRadius:10,padding:"6px 10px",fontSize:13,cursor:pullingSheets?"wait":"pointer",fontWeight:700}}>
              {pullingSheets ? "…" : "☁️"}
            </button>
            <select value={filterMonth} onChange={e=>setFilterMonth(Number(e.target.value))} style={{background:"#2C2C2E",color:"#fff",border:"none",borderRadius:10,padding:"6px 10px",fontSize:13}}>
              {MONTHS.map((m,i)=><option key={i} value={i}>{m}</option>)}
            </select>
            <select value={filterYear} onChange={e=>setFilterYear(Number(e.target.value))} style={{background:"#2C2C2E",color:"#fff",border:"none",borderRadius:10,padding:"6px 10px",fontSize:13}}>
              {[2024,2025,2026].map(y=><option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        {/* Balance Card */}
        <div style={{background:"linear-gradient(135deg,#1C1C2E,#16213E,#0F3460)",borderRadius:24,padding:"24px 20px",marginBottom:16,border:"1px solid rgba(255,255,255,0.08)",boxShadow:"0 8px 32px rgba(0,122,255,0.15)"}}>
          <div style={{fontSize:13,color:"#8E8E93",marginBottom:6}}>Aylık Net Bakiye</div>
          <div style={{fontSize:40,fontWeight:800,letterSpacing:-1,color:balance>=0?"#34C759":"#FF453A"}}>{fmt(balance)}</div>
          <div style={{display:"flex",gap:20,marginTop:20}}>
            <div><div style={{fontSize:11,color:"#8E8E93"}}>↑ GELİR</div><div style={{fontSize:18,fontWeight:700,color:"#34C759"}}>{fmt(totalGelir)}</div></div>
            <div style={{width:1,background:"rgba(255,255,255,0.1)"}}/>
            <div><div style={{fontSize:11,color:"#8E8E93"}}>↓ GİDER</div><div style={{fontSize:18,fontWeight:700,color:"#FF453A"}}>{fmt(totalGider)}</div></div>
            <div style={{marginLeft:"auto"}}><div style={{fontSize:11,color:"#8E8E93"}}>İŞLEM</div><div style={{fontSize:18,fontWeight:700}}>{filteredTx.length}</div></div>
          </div>
          {totalGelir > 0 && (
            <div style={{marginTop:16}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#8E8E93",marginBottom:4}}><span>Harcama Oranı</span><span>{Math.round((totalGider/totalGelir)*100)}%</span></div>
              <div style={{background:"rgba(255,255,255,0.1)",borderRadius:4,height:6}}>
                <div style={{width:`${Math.min((totalGider/totalGelir)*100,100)}%`,background:totalGider/totalGelir>0.8?"#FF453A":"#34C759",height:"100%",borderRadius:4}}/>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tabs: özet | özel hayat | uber | grafikler */}
      <div style={{display:"flex",background:"#1C1C1E",padding:"0 8px",borderBottom:"1px solid #2C2C2E",overflowX:"auto"}}>
        {[{id:"dashboard",icon:"📊",label:"Özet"},{id:"personal",icon:"👤",label:"Özel"},{id:"uber",icon:"🚗",label:"Uber"},{id:"charts",icon:"📈",label:"Grafik"},{id:"suggestions",icon:"🤖",label:"Öneri"}].map(t=>(
          <button key={t.id} type="button" onClick={()=>setTab(t.id)} style={{flex:1,minWidth:56,background:"none",border:"none",color:tab===t.id?"#0A84FF":"#8E8E93",padding:"10px 2px",fontSize:10,cursor:"pointer",fontWeight:tab===t.id?700:400,borderBottom:tab===t.id?"2px solid #0A84FF":"2px solid transparent",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
            <span style={{fontSize:16}}>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{padding:"16px 16px 120px",overflowY:"auto",maxHeight:"calc(100vh - 280px)"}}>

        {tab==="dashboard" && (
          <div>
            {activeTxList.length===0 && <div style={{textAlign:"center",padding:40,color:"#8E8E93"}}><div style={{fontSize:48,marginBottom:12}}>💰</div><div style={{fontSize:18,fontWeight:700,marginBottom:8,color:"#fff"}}>Henüz işlem yok</div><div>Sağ alttaki + butonuyla başla!</div></div>}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
              {[{label:"En Büyük Gider",value:Object.values(giderByCat).sort((a,b)=>b.value-a.value)[0],col:"#FF453A"},{label:"En Büyük Gelir",value:Object.values(gelirByCat).sort((a,b)=>b.value-a.value)[0],col:"#34C759"}].map((s,i)=>s.value?(
                <div key={i} style={{background:"#1C1C1E",borderRadius:16,padding:16}}>
                  <div style={{fontSize:11,color:"#8E8E93",marginBottom:8}}>{s.label}</div>
                  <div style={{fontSize:22,marginBottom:4}}>{s.value.icon}</div>
                  <div style={{fontSize:13,fontWeight:600,marginBottom:2}}>{capitalizeWordsTr(s.value.name)}</div>
                  <div style={{fontSize:16,fontWeight:700,color:s.col}}>{fmt(s.value.value)}</div>
                </div>
              ):null)}
            </div>
            <div style={{fontSize:17,fontWeight:700,marginBottom:10}}>Aylık özet (son 6 ay)</div>
            <div style={{background:"#1C1C1E",borderRadius:14,overflow:"hidden",marginBottom:16,border:"1px solid #2C2C2E"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead>
                  <tr style={{background:"#2C2C2E",color:"#8E8E93",fontSize:10,textAlign:"left"}}>
                    <th style={{padding:"10px 8px",fontWeight:600}}>Ay</th>
                    <th style={{padding:"10px 6px",fontWeight:600,color:"#34C759"}}>+ Gelir</th>
                    <th style={{padding:"10px 6px",fontWeight:600,color:"#FF453A"}}>− Gider</th>
                    <th style={{padding:"10px 8px",fontWeight:600}}>Net</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyData.map((row, idx) => {
                    const sel = row.monthIndex === filterMonth && row.year === filterYear;
                    return (
                      <tr key={idx} style={{borderTop:"1px solid #2C2C2E",background:sel?"#0A84FF12":"transparent"}}>
                        <td style={{padding:"10px 8px",fontWeight:600}}>{row.name} {String(row.year).slice(2)}</td>
                        <td style={{padding:"10px 6px",color:"#34C759"}}>{fmt(row.Gelir)}</td>
                        <td style={{padding:"10px 6px",color:"#FF453A"}}>{fmt(row.Gider)}</td>
                        <td style={{padding:"10px 8px",fontWeight:700,color:row.Net>=0?"#34C759":"#FF453A"}}>{row.Net>=0?"+":""}{fmt(row.Net)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{fontSize:17,fontWeight:700,marginBottom:12}}>Son İşlemler</div>
            {filteredTx.slice(0,5).map(tx=>{
              const cat=getCat(tx.type,tx.category);
              return <div key={tx.id} style={{background:"#1C1C1E",borderRadius:14,padding:"12px 14px",marginBottom:8,display:"flex",alignItems:"flex-start",gap:12}}>
                <div style={{width:42,height:42,borderRadius:12,background:cat.color+"25",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>{cat.icon}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginBottom:4}}>
                    <span style={{fontSize:10,fontWeight:700,letterSpacing:0.3,padding:"2px 8px",borderRadius:6,background:tx.type==="gelir"?"#34C75928":"#FF453A28",color:tx.type==="gelir"?"#34C759":"#FF453A"}}>{txTypeLabel(tx)}</span>
                    {tx.isUber && <span style={{fontSize:10,background:"#E65100",borderRadius:6,padding:"2px 6px",fontWeight:700}}>Uber</span>}
                    <span style={{fontSize:12,fontWeight:600,color:"#AEAEB2",display:"inline-flex",alignItems:"center",gap:5}}>
                      <span style={{fontWeight:800,color:tx.type==="gelir"?"#34C759":"#FF453A",fontSize:13}}>{tx.type==="gelir"?"+":"−"}</span>
                      {capitalizeWordsTr(cat.label)}
                    </span>
                  </div>
                  <div style={{fontSize:14,fontWeight:600,lineHeight:1.35,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden",wordBreak:"break-word"}}>{capitalizeWordsTr(tx.desc||cat.label)}</div>
                  <div style={{fontSize:11,color:"#8E8E93",marginTop:4}}>{tx.date}</div>
                </div>
                <div style={{fontSize:15,fontWeight:700,color:tx.type==="gelir"?"#34C759":"#FF453A",flexShrink:0,textAlign:"right",minWidth:72}}>{tx.type==="gelir"?"+":"-"}{fmt(tx.amount)}</div>
              </div>;
            })}
            {suggestions[0] && <div style={{background:"linear-gradient(135deg,#1C2D4A,#0A84FF20)",borderRadius:16,padding:16,marginTop:8,border:"1px solid #0A84FF30"}}><div style={{fontSize:12,color:"#0A84FF",fontWeight:700,marginBottom:6}}>🤖 AI ÖNERİSİ</div><div style={{fontSize:14,lineHeight:1.5,color:"#E5E5EA"}}>{suggestions[0].text}</div></div>}
          </div>
        )}

        {tab==="personal" && (
          <div>
            <div style={{fontSize:13,color:"#8E8E93",marginBottom:12,lineHeight:1.4}}>Özel hayat: Uber dışı gelir ve giderler ({MONTHS[filterMonth]} {filterYear})</div>
            {filteredPersonalTx.length===0 && <div style={{textAlign:"center",padding:40,color:"#8E8E93"}}><div style={{fontSize:40,marginBottom:12}}>👤</div><div>Bu ay özel hayat işlemi yok</div></div>}
            {filteredPersonalTx.map(tx=>{
              const cat=getCat(tx.type,tx.category);
              return <div key={tx.id} style={{background:"#1C1C1E",borderRadius:14,padding:14,marginBottom:8,display:"flex",alignItems:"flex-start",gap:12}}>
                <div style={{width:46,height:46,borderRadius:14,background:cat.color+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0,border:`1px solid ${cat.color}40`}}>{cat.icon}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginBottom:4}}>
                    <span style={{fontSize:10,fontWeight:700,letterSpacing:0.3,padding:"2px 8px",borderRadius:6,background:tx.type==="gelir"?"#34C75928":"#FF453A28",color:tx.type==="gelir"?"#34C759":"#FF453A"}}>{txTypeLabel(tx)}</span>
                    <span style={{fontSize:12,fontWeight:600,color:"#AEAEB2",display:"inline-flex",alignItems:"center",gap:5}}>
                      <span style={{fontWeight:800,color:tx.type==="gelir"?"#34C759":"#FF453A",fontSize:14}} title={tx.type==="gelir"?"Gelir":"Gider"}>{tx.type==="gelir"?"+":"−"}</span>
                      {capitalizeWordsTr(cat.label)}
                    </span>
                  </div>
                  <div style={{fontSize:15,fontWeight:600,lineHeight:1.35,display:"-webkit-box",WebkitLineClamp:3,WebkitBoxOrient:"vertical",overflow:"hidden",wordBreak:"break-word"}}>{capitalizeWordsTr(tx.desc||cat.label)}</div>
                  <div style={{fontSize:11,color:"#8E8E93",marginTop:4}}>{tx.date}</div>
                </div>
                <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6,flexShrink:0}}>
                  <div style={{fontSize:16,fontWeight:700,color:tx.type==="gelir"?"#34C759":"#FF453A",textAlign:"right",minWidth:76}}>{tx.type==="gelir"?"+":"-"}{fmt(tx.amount)}</div>
                  <button type="button" onClick={()=>setDeleteId(tx.id)} style={{background:"#FF453A20",border:"none",color:"#FF453A",borderRadius:8,padding:"3px 10px",fontSize:11,cursor:"pointer"}}>Sil</button>
                </div>
              </div>;
            })}
          </div>
        )}

        {tab==="uber" && (
          <div>
            <div style={{fontSize:13,color:"#8E8E93",marginBottom:12,lineHeight:1.4}}>Uber işi: haftalık ekstre ve işe bağlı kayıtlar ({MONTHS[filterMonth]} {filterYear})</div>
            {filteredUberTx.length===0 && <div style={{textAlign:"center",padding:40,color:"#8E8E93"}}><div style={{fontSize:40,marginBottom:12}}>🚗</div><div>Bu ay Uber işlemi yok</div></div>}
            {filteredUberTx.map(tx=>{
              const cat=getCat(tx.type,tx.category);
              return <div key={tx.id} style={{background:"#1C1C1E",borderRadius:14,padding:14,marginBottom:8,display:"flex",alignItems:"flex-start",gap:12,border:"1px solid #E6510030"}}>
                <div style={{width:46,height:46,borderRadius:14,background:cat.color+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0,border:`1px solid ${cat.color}40`}}>{cat.icon}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginBottom:4}}>
                    <span style={{fontSize:10,fontWeight:700,letterSpacing:0.3,padding:"2px 8px",borderRadius:6,background:tx.type==="gelir"?"#34C75928":"#FF453A28",color:tx.type==="gelir"?"#34C759":"#FF453A"}}>{txTypeLabel(tx)}</span>
                    <span style={{fontSize:10,background:"#E65100",borderRadius:6,padding:"2px 6px",fontWeight:700}}>Uber</span>
                    <span style={{fontSize:12,fontWeight:600,color:"#AEAEB2",display:"inline-flex",alignItems:"center",gap:5}}>
                      <span style={{fontWeight:800,color:tx.type==="gelir"?"#34C759":"#FF453A",fontSize:14}}>{tx.type==="gelir"?"+":"−"}</span>
                      {capitalizeWordsTr(cat.label)}
                    </span>
                  </div>
                  <div style={{fontSize:15,fontWeight:600,lineHeight:1.35,display:"-webkit-box",WebkitLineClamp:3,WebkitBoxOrient:"vertical",overflow:"hidden",wordBreak:"break-word"}}>{capitalizeWordsTr(tx.desc||cat.label)}</div>
                  <div style={{fontSize:11,color:"#8E8E93",marginTop:4}}>{tx.date}</div>
                </div>
                <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6,flexShrink:0}}>
                  <div style={{fontSize:16,fontWeight:700,color:tx.type==="gelir"?"#34C759":"#FF453A",textAlign:"right",minWidth:76}}>{tx.type==="gelir"?"+":"-"}{fmt(tx.amount)}</div>
                  <button type="button" onClick={()=>setDeleteId(tx.id)} style={{background:"#FF453A20",border:"none",color:"#FF453A",borderRadius:8,padding:"3px 10px",fontSize:11,cursor:"pointer"}}>Sil</button>
                </div>
              </div>;
            })}
          </div>
        )}

        {tab==="charts" && (
          <div>
            <div style={{fontSize:17,fontWeight:700,marginBottom:16}}>6 Aylık Trend</div>
            <div style={{background:"#1C1C1E",borderRadius:20,padding:16,marginBottom:16}}>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={monthlyData} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2C2C2E"/>
                  <XAxis dataKey="name" tick={{fill:"#8E8E93",fontSize:11}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:"#8E8E93",fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>v>=1000?`${v/1000}k`:v}/>
                  <Tooltip formatter={v=>fmt(v)} contentStyle={{background:"#2C2C2E",border:"none",borderRadius:12,color:"#fff"}}/>
                  <Bar dataKey="Gelir" fill="#34C759" radius={[4,4,0,0]}/>
                  <Bar dataKey="Gider" fill="#FF453A" radius={[4,4,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
            {pieGiderData.length>0 && <>
              <div style={{fontSize:17,fontWeight:700,marginBottom:16}}>Gider Dağılımı</div>
              <div style={{background:"#1C1C1E",borderRadius:20,padding:16,marginBottom:16}}>
                <div style={{display:"flex",alignItems:"center"}}>
                  <ResponsiveContainer width="55%" height={180}>
                    <PieChart><Pie data={pieGiderData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" paddingAngle={3}>{pieGiderData.map((d,i)=><Cell key={i} fill={d.color}/>)}</Pie><Tooltip formatter={v=>fmt(v)} contentStyle={{background:"#2C2C2E",border:"none",borderRadius:12,color:"#fff"}}/></PieChart>
                  </ResponsiveContainer>
                  <div style={{flex:1,paddingLeft:8}}>
                    {pieGiderData.sort((a,b)=>b.value-a.value).slice(0,5).map((d,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
                        <div style={{width:8,height:8,borderRadius:"50%",background:d.color,flexShrink:0}}/>
                        <div style={{fontSize:11,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.icon} {capitalizeWordsTr(d.name)}</div>
                        <div style={{fontSize:11,color:"#FF453A",fontWeight:600}}>{Math.round((d.value/totalGider)*100)}%</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>}
            {pieGelirData.length>0 && <>
              <div style={{fontSize:17,fontWeight:700,marginBottom:16}}>Gelir Dağılımı</div>
              <div style={{background:"#1C1C1E",borderRadius:20,padding:16}}>
                <div style={{display:"flex",alignItems:"center"}}>
                  <ResponsiveContainer width="55%" height={150}>
                    <PieChart><Pie data={pieGelirData} cx="50%" cy="50%" innerRadius={35} outerRadius={60} dataKey="value" paddingAngle={3}>{pieGelirData.map((d,i)=><Cell key={i} fill={d.color}/>)}</Pie><Tooltip formatter={v=>fmt(v)} contentStyle={{background:"#2C2C2E",border:"none",borderRadius:12,color:"#fff"}}/></PieChart>
                  </ResponsiveContainer>
                  <div style={{flex:1}}>
                    {pieGelirData.map((d,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
                        <div style={{width:8,height:8,borderRadius:"50%",background:d.color,flexShrink:0}}/>
                        <div style={{fontSize:12,flex:1}}>{d.icon} {capitalizeWordsTr(d.name)}</div>
                        <div style={{fontSize:12,color:"#34C759",fontWeight:600}}>{fmt(d.value)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>}
          </div>
        )}

        {tab==="suggestions" && (
          <div>
            <div style={{background:"linear-gradient(135deg,#1C2D4A,#0A1628)",borderRadius:20,padding:20,marginBottom:16,border:"1px solid #0A84FF30"}}>
              <div style={{fontSize:13,color:"#0A84FF",fontWeight:700,marginBottom:4}}>🤖 AI FİNANS DANIŞMANI</div>
              <div style={{fontSize:22,fontWeight:800,marginBottom:8}}>Bütçe Analizi</div>
              <div style={{fontSize:14,color:"#8E8E93",lineHeight:1.6}}>{MONTHS[filterMonth]} {filterYear} — {filteredTx.length} işlem.{balance>=0?` ${fmt(balance)} fazla! 🎉`:` ${fmt(Math.abs(balance))} açık ⚠️`}</div>
            </div>
            {suggestions.length===0 && <div style={{textAlign:"center",padding:40,color:"#8E8E93"}}><div style={{fontSize:40,marginBottom:12}}>✅</div><div>Bütçeniz dengeli!</div></div>}
            {suggestions.map((s,i)=>(
              <div key={i} style={{background:s.type==="warning"?"#FF453A15":s.type==="positive"?"#34C75915":"#0A84FF10",border:`1px solid ${s.type==="warning"?"#FF453A30":s.type==="positive"?"#34C75930":"#0A84FF30"}`,borderRadius:16,padding:16,marginBottom:12}}>
                <div style={{fontSize:24,marginBottom:8}}>{s.icon}</div>
                <div style={{fontSize:14,lineHeight:1.6}}>{s.text}</div>
              </div>
            ))}
            <div style={{fontSize:17,fontWeight:700,marginBottom:12}}>💡 Bütçe Hedefleri</div>
            {[{label:"Tasarruf (%20)",target:totalGelir*0.2,current:balance},{label:"Gıda Limiti (%15)",target:totalGelir*0.15,current:(giderByCat["market"]?.value||0)+(giderByCat["yemek"]?.value||0)},{label:"Eğlence Limiti (%5)",target:totalGelir*0.05,current:giderByCat["eglence"]?.value||0}].map((g,i)=>{
              const pct=totalGelir>0?Math.min((g.current/g.target)*100,100):0; const over=g.current>g.target;
              return <div key={i} style={{background:"#1C1C1E",borderRadius:14,padding:14,marginBottom:8}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}><div style={{fontSize:13,fontWeight:600}}>{g.label}</div><div style={{fontSize:12,color:over?"#FF453A":"#34C759"}}>{fmt(g.current)} / {fmt(g.target)}</div></div>
                <div style={{background:"#2C2C2E",borderRadius:4,height:8}}><div style={{width:`${pct}%`,background:over?"#FF453A":"#34C759",height:"100%",borderRadius:4}}/></div>
              </div>;
            })}
          </div>
        )}
      </div>

      {/* FAB */}
      <div style={{position:"fixed",bottom:24,right:16,display:"flex",flexDirection:"column",gap:10,zIndex:100}}>
        <input ref={uberFileRef} type="file" accept="application/pdf" onChange={pickPdfFile} onClick={e=>e.target.value=""} style={{display:"none"}}/>
        <button onClick={()=>setResetStep(1)} style={{width:48,height:48,borderRadius:"50%",background:"#3A3A3C",border:"none",color:"#fff",fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>🗑️</button>
        <button onClick={()=>uberFileRef.current.click()} style={{width:48,height:48,borderRadius:"50%",background:"#E65100",border:"none",color:"#fff",fontSize:18,cursor:"pointer",boxShadow:"0 4px 20px rgba(230,81,0,0.4)",display:"flex",alignItems:"center",justifyContent:"center"}}>🚗</button>
        <button onClick={()=>openAdd("gelir")} style={{width:56,height:56,borderRadius:"50%",background:"#34C759",border:"none",color:"#fff",fontSize:26,cursor:"pointer",boxShadow:"0 4px 20px rgba(52,199,89,0.4)",display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
        <button onClick={()=>openAdd("gider")} style={{width:56,height:56,borderRadius:"50%",background:"#FF453A",border:"none",color:"#fff",fontSize:26,cursor:"pointer",boxShadow:"0 4px 20px rgba(255,69,58,0.4)",display:"flex",alignItems:"center",justifyContent:"center"}}>−</button>
      </div>

      {/* ADD MODAL */}
      {showModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:1000,display:"flex",alignItems:"flex-end",backdropFilter:"blur(10px)"}} onClick={e=>e.target===e.currentTarget&&setShowModal(false)}>
          <div style={{background:"#1C1C1E",borderRadius:"24px 24px 0 0",padding:"20px 20px 40px",width:"100%",maxHeight:"90vh",overflowY:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div style={{fontSize:20,fontWeight:700}}>{form.type==="gelir"?"💚 Gelir Ekle":"🔴 Gider Ekle"}</div>
              <button onClick={()=>setShowModal(false)} style={{background:"#2C2C2E",border:"none",color:"#fff",borderRadius:"50%",width:32,height:32,cursor:"pointer",fontSize:16}}>✕</button>
            </div>

            {/* Type */}
            <div style={{display:"flex",background:"#2C2C2E",borderRadius:12,padding:4,marginBottom:16}}>
              {["gelir","gider"].map(t=>(
                <button key={t} onClick={()=>setForm(f=>({...f,type:t,category:t==="gelir"?"maas":"market",isUber:false}))} style={{flex:1,padding:8,border:"none",borderRadius:10,cursor:"pointer",background:form.type===t?(t==="gelir"?"#34C759":"#FF453A"):"transparent",color:"#fff",fontWeight:700,fontSize:14}}>
                  {t==="gelir"?"💚 Gelir":"🔴 Gider"}
                </button>
              ))}
            </div>

            {/* Receipt */}
            <div style={{marginBottom:16}}>
              <div style={{fontSize:13,color:"#8E8E93",marginBottom:8}}>📷 Fiş Yükle (AI ile Otomatik Oku)</div>
              <input ref={fileRef} type="file" accept="image/*" onChange={handleReceiptUpload} onClick={e=>e.target.value=""} style={{display:"none"}}/>
              <button onClick={()=>fileRef.current.click()} style={{width:"100%",background:"#2C2C2E",border:"2px dashed #3A3A3C",borderRadius:14,color:"#0A84FF",padding:16,cursor:"pointer",fontSize:14,fontWeight:600}}>
                {ocrLoading?"⏳ Fiş Okunuyor...":"📸 Fiş Fotoğrafı Çek veya Seç"}
              </button>
              {receiptPreview && <img src={receiptPreview} alt="fiş" style={{width:"100%",borderRadius:12,marginTop:8,maxHeight:150,objectFit:"cover"}}/>}
            </div>

            {/* Amount */}
            <div style={{marginBottom:12}}>
              <div style={{fontSize:13,color:"#8E8E93",marginBottom:6}}>Tutar (CAD$)</div>
              <input value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} type="number" placeholder="0.00"
                style={{width:"100%",background:"#2C2C2E",border:"none",borderRadius:12,padding:"14px 16px",color:"#fff",fontSize:22,fontWeight:700,outline:"none",boxSizing:"border-box"}}/>
            </div>

            {/* Desc */}
            <div style={{marginBottom:12}}>
              <div style={{fontSize:13,color:"#8E8E93",marginBottom:6}}>Açıklama</div>
              <input value={form.desc} onChange={e=>setForm(f=>({...f,desc:e.target.value}))} placeholder="İşlem açıklaması..."
                style={{width:"100%",background:"#2C2C2E",border:"none",borderRadius:12,padding:"12px 16px",color:"#fff",fontSize:15,outline:"none",boxSizing:"border-box"}}/>
            </div>

            {/* Category */}
            <div style={{marginBottom:12}}>
              <div style={{fontSize:13,color:"#8E8E93",marginBottom:8}}>Kategori</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
                {CATEGORIES[form.type].map(cat=>(
                  <button key={cat.id} onClick={()=>setForm(f=>({...f,category:cat.id,isUber:cat.id.includes("uber")?true:f.isUber}))} style={{background:form.category===cat.id?cat.color+"30":"#2C2C2E",border:form.category===cat.id?`2px solid ${cat.color}`:"2px solid transparent",borderRadius:12,padding:"10px 4px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                    <span style={{fontSize:20}}>{cat.icon}</span>
                    <span style={{fontSize:10,color:"#fff",textAlign:"center"}}>{cat.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Uber Toggle */}
            <div style={{marginBottom:12}}>
              <button onClick={()=>setForm(f=>({...f,isUber:!f.isUber}))} style={{width:"100%",background:form.isUber?"#E6510030":"#2C2C2E",border:form.isUber?"2px solid #E65100":"2px solid transparent",borderRadius:14,padding:14,color:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:10,fontSize:15,fontWeight:700}}>
                <span style={{fontSize:22}}>🚗</span>
                {form.isUber?"✅ Uber İşlemi (İş)":"Uber İşlemi mi?"}
              </button>
            </div>

            {/* Date */}
            <div style={{marginBottom:20}}>
              <div style={{fontSize:13,color:"#8E8E93",marginBottom:6}}>Tarih</div>
              <input type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}
                style={{width:"100%",background:"#2C2C2E",border:"none",borderRadius:12,padding:"12px 16px",color:"#fff",fontSize:15,outline:"none",boxSizing:"border-box"}}/>
            </div>

            <button onClick={handleAdd} style={{width:"100%",background:form.type==="gelir"?"#34C759":"#FF453A",border:"none",borderRadius:16,padding:18,color:"#fff",fontSize:17,fontWeight:700,cursor:"pointer",boxShadow:`0 4px 20px ${form.type==="gelir"?"rgba(52,199,89,0.4)":"rgba(255,69,58,0.4)"}`}}>
              {form.type==="gelir"?"💚 Gelir Ekle":"🔴 Gider Ekle"}
            </button>
          </div>
        </div>
      )}

      {/* Delete */}
      {deleteId && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
          <div style={{background:"#1C1C1E",borderRadius:20,padding:24,width:"100%"}}>
            <div style={{fontSize:18,fontWeight:700,marginBottom:12}}>İşlemi Sil</div>
            <div style={{color:"#8E8E93",marginBottom:20}}>Bu işlemi silmek istediğine emin misin?</div>
            <div style={{display:"flex",gap:12}}>
              <button onClick={()=>setDeleteId(null)} style={{flex:1,background:"#2C2C2E",border:"none",color:"#fff",borderRadius:12,padding:14,cursor:"pointer",fontWeight:600}}>İptal</button>
              <button onClick={()=>handleDelete(deleteId)} style={{flex:1,background:"#FF453A",border:"none",color:"#fff",borderRadius:12,padding:14,cursor:"pointer",fontWeight:600}}>Sil</button>
            </div>
          </div>
        </div>
      )}

      {/* Reset 1 */}
      {resetStep===1 && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:24,backdropFilter:"blur(10px)"}}>
          <div style={{background:"#1C1C1E",borderRadius:24,padding:28,width:"100%",border:"1px solid #FF453A40"}}>
            <div style={{fontSize:48,textAlign:"center",marginBottom:16}}>⚠️</div>
            <div style={{fontSize:20,fontWeight:800,marginBottom:8,textAlign:"center"}}>Tüm Verileri Sil?</div>
            <div style={{color:"#8E8E93",marginBottom:24,textAlign:"center",lineHeight:1.6}}>Tüm işlemler silinecek. Geri alınamaz!</div>
            <div style={{display:"flex",gap:12}}>
              <button onClick={()=>setResetStep(0)} style={{flex:1,background:"#2C2C2E",border:"none",color:"#fff",borderRadius:12,padding:14,cursor:"pointer",fontWeight:600}}>İptal</button>
              <button onClick={()=>setResetStep(2)} style={{flex:1,background:"#FF453A",border:"none",color:"#fff",borderRadius:12,padding:14,cursor:"pointer",fontWeight:700}}>Devam Et</button>
            </div>
          </div>
        </div>
      )}

      {/* Reset 2 */}
      {resetStep===2 && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:24,backdropFilter:"blur(10px)"}}>
          <div style={{background:"#1C1C1E",borderRadius:24,padding:28,width:"100%",border:"1px solid #FF453A60"}}>
            <div style={{fontSize:48,textAlign:"center",marginBottom:16}}>🚨</div>
            <div style={{fontSize:20,fontWeight:800,marginBottom:8,textAlign:"center",color:"#FF453A"}}>EMİN MİSİN?</div>
            <div style={{color:"#8E8E93",marginBottom:24,textAlign:"center",lineHeight:1.6}}>Tüm veriler hem uygulamadan hem Sheets'ten <span style={{color:"#FF453A",fontWeight:700}}>silinecek</span>.</div>
            <div style={{display:"flex",gap:12}}>
              <button onClick={()=>setResetStep(0)} style={{flex:1,background:"#2C2C2E",border:"none",color:"#fff",borderRadius:12,padding:14,cursor:"pointer",fontWeight:600}}>Vazgeç</button>
              <button onClick={handleReset} style={{flex:1,background:"#FF453A",border:"2px solid #FF6B6B",color:"#fff",borderRadius:12,padding:14,cursor:"pointer",fontWeight:800,fontSize:15}}>🗑️ Evet, Sil!</button>
            </div>
          </div>
        </div>
      )}

      {/* PDF: Uber mi özel mi */}
      {showPdfUberChoice && pendingPdfFile && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:2100,display:"flex",alignItems:"center",justifyContent:"center",padding:24,backdropFilter:"blur(10px)"}} onClick={(e)=>{if(e.target===e.currentTarget){setShowPdfUberChoice(false);setPendingPdfFile(null);}}}>
          <div style={{background:"#1C1C1E",borderRadius:24,padding:28,width:"100%",maxWidth:360,border:"1px solid #3A3A3C"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:18,fontWeight:800,marginBottom:8}}>PDF türü</div>
            <div style={{fontSize:14,color:"#8E8E93",marginBottom:20,lineHeight:1.5}}>Bu PDF <strong style={{color:"#fff"}}>Uber haftalık ekstresi</strong> mi, yoksa <strong style={{color:"#fff"}}>özel hayat</strong> için mi? (İçe aktarılan satırlar buna göre işaretlenir.)</div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <button type="button" onClick={()=>startPdfParse(true)} style={{width:"100%",background:"#E65100",border:"none",color:"#fff",borderRadius:14,padding:16,cursor:"pointer",fontWeight:700,fontSize:15}}>🚗 Evet, Uber işi (ekstre)</button>
              <button type="button" onClick={()=>startPdfParse(false)} style={{width:"100%",background:"#2C2C2E",border:"1px solid #48484A",color:"#fff",borderRadius:14,padding:16,cursor:"pointer",fontWeight:600,fontSize:15}}>👤 Hayır, özel / diğer</button>
              <button type="button" onClick={()=>{setShowPdfUberChoice(false);setPendingPdfFile(null);}} style={{width:"100%",background:"transparent",border:"none",color:"#8E8E93",padding:12,cursor:"pointer",fontSize:14}}>Vazgeç</button>
            </div>
          </div>
        </div>
      )}

      {/* Uber Modal */}
      {showUberModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:24,backdropFilter:"blur(10px)"}}>
          <div style={{background:"#1C1C1E",borderRadius:24,padding:28,width:"100%",border:"1px solid #3A3A3C"}}>
            {uberLoading ? (
              <div style={{textAlign:"center",padding:20}}>
                <div style={{fontSize:48,marginBottom:16}}>🚗</div>
                <div style={{fontSize:18,fontWeight:700,marginBottom:8}}>PDF Okunuyor...</div>
                <div style={{color:"#8E8E93",fontSize:14}}>PDF metni okunuyor…</div>
              </div>
            ) : uberResult ? (
              <div>
                <div style={{fontSize:20,fontWeight:800,marginBottom:4}}>{uberImportIsUber ? "🚗 Uber Ekstre Özeti" : "📄 PDF Özeti (özel)"}</div>
                <div style={{fontSize:13,color:"#8E8E93",marginBottom:20}}>{uberResult.period_start} → {uberResult.period_end}{uberImportIsUber ? "" : " · Özel hayat olarak kaydedilecek"}</div>
                <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:24}}>
                  <div style={{background:"#34C75915",border:"1px solid #34C75930",borderRadius:14,padding:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div style={{fontSize:12,color:"#8E8E93"}}>💚 NET KAZANÇ</div>
                    <div style={{fontSize:22,fontWeight:800,color:"#34C759"}}>{fmt(uberResult.earnings)}</div>
                  </div>
                  <div style={{background:"#FF453A15",border:"1px solid #FF453A30",borderRadius:14,padding:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div style={{fontSize:12,color:"#8E8E93"}}>🔴 GİDERLER</div>
                    <div style={{fontSize:22,fontWeight:800,color:"#FF453A"}}>{fmt(uberResult.expenses)}</div>
                  </div>
                  <div style={{background:"#0A84FF15",border:"1px solid #0A84FF30",borderRadius:14,padding:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div style={{fontSize:12,color:"#8E8E93"}}>💳 TOPLAM ÖDEME</div>
                    <div style={{fontSize:22,fontWeight:800,color:"#0A84FF"}}>{fmt(uberResult.total)}</div>
                  </div>
                </div>
                <div style={{display:"flex",gap:12}}>
                  <button onClick={()=>{setShowUberModal(false);setUberResult(null);}} style={{flex:1,background:"#2C2C2E",border:"none",color:"#fff",borderRadius:12,padding:14,cursor:"pointer",fontWeight:600}}>İptal</button>
                  <button type="button" onClick={()=>confirmUberImport(uberResult, uberImportIsUber)} style={{flex:2,background:"#34C759",border:"none",color:"#fff",borderRadius:12,padding:14,cursor:"pointer",fontWeight:700,fontSize:15}}>✅ İçe Aktar</button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}



      <style>{`
        * { -webkit-tap-highlight-color: transparent; }
        input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(1); }
        input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; }
      `}</style>
    </div>
  );
}
