import { useState, useRef, useEffect, useMemo } from "react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const SHEETS_URL =
  import.meta.env.VITE_SHEETS_URL ||
  "https://script.google.com/macros/s/AKfycbwTVwsJDkvfFW5lI27Zo3i7p_PfjnCiHkhH8u8ztuaIBVowPQc0D4pZWnXXKJCfkEtTIw/exec";

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

/** PDF / fiş tutarları (Uber ekstre + OCR) */
function parseNum(str) {
  if (str == null || str === "") return 0;
  let s = String(str).trim();
  if (!s) return 0;
  if (s.includes(".") && s.includes(",")) {
    return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
  }
  if (s.includes(",")) {
    const parts = s.split(",");
    if (parts[1] && parts[1].length === 3 && !parts[2]) {
      return parseFloat(s.replace(/,/g, "")) || 0;
    }
    return parseFloat(s.replace(",", ".")) || 0;
  }
  return parseFloat(s) || 0;
}

/** jsDelivr’da pdfjs-dist@3.x /build/pdf.mjs çoğu zaman 404; 4.8.x yolu stabil */
const PDFJS_MAIN =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.mjs";
const PDFJS_WORKER =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.mjs";


function pdfPageItemsToReadingOrder(items) {
  const withPos = items
    .filter((it) => "str" in it && it.str && String(it.str).trim())
    .map((it) => {
      const t = it.transform;
      return { str: it.str, x: t[4], y: t[5] };
    });
  withPos.sort((a, b) => {
    if (Math.abs(a.y - b.y) > 4) return b.y - a.y;
    return a.x - b.x;
  });
  let out = "";
  let lastY = withPos.length ? withPos[0].y : 0;
  for (const it of withPos) {
    if (Math.abs(it.y - lastY) > 4) {
      out += "\n";
      lastY = it.y;
    }
    out += it.str + " ";
  }
  return out;
}
async function extractPdfTextFromBuffer(arrayBuffer) {
  const mod = await import(/* @vite-ignore */ PDFJS_MAIN);
  const getDocument = mod.getDocument;
  const { GlobalWorkerOptions } = mod;
  if (!getDocument) throw new Error("pdf.js modülü geçersiz");
  GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const pdf = await getDocument({ data: arrayBuffer }).promise;
  let full = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    full += pdfPageItemsToReadingOrder(content.items) + "\n";
  }
  return full;
}

/** PDF.js metni bazen kelimeyi böler; tek satır + anahtar kelime yakınında tutar ara */
function uberMoneyInWindow(haystack, startIdx, winLen) {
  const w = haystack.slice(startIdx, startIdx + winLen);
  const tries = [
    /-\s*\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/,
    /\$\s*-\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/,
    /(?:CA\$|CAD|USD)\s*\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/,
    /\b([\d]{1,3}(?:[.,]\d{3})*(?:\.\d{2}))\b/,
  ];
  for (const re of tries) {
    const m = w.match(re);
    if (m && m[1]) {
      const v = Math.abs(parseNum(m[1]));
      if (v > 0 && v < 1e7) return v;
    }
  }
  return null;
}

function uberFindAfterKeywords(haystack, keywords, window = 320) {
  const lower = haystack.toLowerCase();
  for (const kw of keywords) {
    const k = kw.toLowerCase();
    let from = 0;
    let idx;
    while ((idx = lower.indexOf(k, from)) >= 0) {
      const v = uberMoneyInWindow(haystack, idx, window);
      if (v != null) return v;
      from = idx + k.length;
    }
  }
  return 0;
}


/** Son care: Uber metninde en buyuk iki tutari brut / net gibi yorumla */
function uberFallbackGrossNetFromAmounts(hay) {
  if (!/uber|driver|partner|weekly|payout|earn|statement|payment/i.test(hay)) return null;
  const amounts = [];
  const re = /\b(?:CA\$|CAD|\$|€)?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))\b/gi;
  let m;
  while ((m = re.exec(hay)) !== null) {
    const v = parseNum(m[1]);
    if (v >= 1 && v < 1e6) amounts.push(v);
  }
  const uniq = [...new Set(amounts.map((v) => Math.round(v * 100) / 100))].sort((a, b) => b - a);
  if (uniq.length < 2) return null;
  const a0 = uniq[0];
  const a1 = uniq[1];
  const diff = a0 - a1;
  if (diff <= 0 || diff >= a0 * 0.45) return null;
  if (a1 < a0 * 0.2) return null;
  const earnings = a0;
  const total = a1;
  const expenses = Math.round(diff * 100) / 100;
  return { earnings, expenses, total };
}
/** Uber ekstre PDF metninden kazanç / gider (EN/FR; PDF düzeni kırık olsa da) */
function parseUberStatementPlainText(text) {
  const raw = text.replace(/\u00a0/g, " ");
  const flat = raw.replace(/[\t ]+/g, " ").trim();
  const oneLine = raw.replace(/\s+/g, " ").trim();

  // Turkce Uber ozet satirlari:
  // Kazanclariniz / Para iadeleri ve Giderler / Onceki haftalardaki etkinlikler / Odemeler
  const trEarn = oneLine.match(/Kazan[çc]lar[ıi]n[ıi]z[^\d]{0,120}CA\$?\s*([\d.,]+)/i);
  const trExp = oneLine.match(/Para\s+iadeleri\s+ve\s+Giderler[^\d]{0,120}CA\$?\s*([\d.,]+)/i);
  const trPrev = oneLine.match(/[ÖO]nceki\s+haftalardaki\s+etkinlikler[^\d]{0,140}CA\$?\s*([\d.,]+)/i);
  const trPay = oneLine.match(/[ÖO]demeler[^\d]{0,120}CA\$?\s*([\d.,]+)/i);
  if (trEarn || trExp || trPay) {
    const trEarnings = parseNum(trEarn?.[1] || 0) + parseNum(trPrev?.[1] || 0);
    const trExpenses = parseNum(trExp?.[1] || 0);
    let trTotal = parseNum(trPay?.[1] || 0);

    // "16 Mar 2026 04 - 23 Mar 2026 00" formati
    let period_start = "";
    let period_end = "";
    const trRange = oneLine.match(
      /(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü]{3,})\s+(\d{4})\s+\d{2}\s*[-–]\s*(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü]{3,})\s+(\d{4})\s+\d{2}/
    );
    if (trRange) {
      const mon = {
        jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
        oca: 1, sub: 2, mar: 3, nis: 4, may: 5, haz: 6, tem: 7, agu: 8, eyl: 9, eki: 10, kas: 11, ara: 12,
      };
      const m1 = mon[(trRange[2] || "").toLocaleLowerCase("tr-TR").replace("ş", "s").replace("ğ", "g").replace("ü", "u").replace("ı", "i").replace("ö", "o").replace("ç", "c").slice(0, 3)];
      const m2 = mon[(trRange[5] || "").toLocaleLowerCase("tr-TR").replace("ş", "s").replace("ğ", "g").replace("ü", "u").replace("ı", "i").replace("ö", "o").replace("ç", "c").slice(0, 3)];
      if (m1 && m2) {
        period_start = `${trRange[3]}-${String(m1).padStart(2, "0")}-${String(trRange[1]).padStart(2, "0")}`;
        period_end = `${trRange[6]}-${String(m2).padStart(2, "0")}-${String(trRange[4]).padStart(2, "0")}`;
      }
    }
    if (!period_end) period_end = new Date().toISOString().split("T")[0];
    if (!period_start) period_start = period_end;
    if (!trTotal && (trEarnings || trExpenses)) trTotal = Math.round((trEarnings + trExpenses) * 100) / 100;

    return {
      earnings: Math.round(trEarnings * 100) / 100,
      expenses: Math.round(trExpenses * 100) / 100,
      total: Math.round(trTotal * 100) / 100,
      period_start,
      period_end,
    };
  }

  const k = oneLine.match(/KAZANC:\s*([\d.,]+)/i);
  const o = oneLine.match(/ONCEKI:\s*([\d.,]+)/i);
  const g = oneLine.match(/GIDER:\s*([\d.,]+)/i);
  const totM = oneLine.match(/TOPLAM:\s*([\d.,]+)/i);
  const bs = oneLine.match(/BASLANGIC:(\d{4}-\d{2}-\d{2})/i);
  const be = oneLine.match(/BITIS:(\d{4}-\d{2}-\d{2})/i);
  if (k || g || totM) {
    let earnings = (k ? parseNum(k[1]) : 0) + (o ? parseNum(o[1]) : 0);
    const expenses = g ? parseNum(g[1]) : 0;
    let total = totM ? parseNum(totM[1]) : 0;
    let period_start = bs ? bs[1] : "";
    let period_end = be ? be[1] : "";
    earnings = Math.round(earnings * 100) / 100;
    if (!period_end) period_end = new Date().toISOString().split("T")[0];
    if (!period_start) period_start = period_end;
    if (!total && (earnings || expenses)) total = Math.round((earnings - expenses) * 100) / 100;
    return { earnings, expenses, total, period_start, period_end };
  }

  const hay = oneLine;
  const hayLo = hay.toLowerCase();

  let earnings = 0;
  const earnPatterns = [
    /your\s+earnings[^\d]{0,120}?\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /total\s+earnings[^\d]{0,120}?\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /net\s+earnings[^\d]{0,120}?\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /trip\s+earnings[^\d]{0,120}?\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /gross\s+earnings[^\d]{0,120}?\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /\bearnings\b[^\d$]{0,80}?\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /vos\s+revenus[^\d]{0,120}?\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /revenus\s+totaux[^\d]{0,120}?\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /(?:you\s+earned|payment\s+summary|driver\s+summary)[^\d]{0,160}?\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
  ];
  for (const re of earnPatterns) {
    const m = hay.match(re);
    if (m) {
      earnings = parseNum(m[1]);
      break;
    }
  }
  if (!earnings) {
    earnings = uberFindAfterKeywords(hay, [
      "your earnings",
      "total earnings",
      "net earnings",
      "trip earnings",
      "earnings this week",
      "weekly earnings",
      "you earned",
      "payment summary",
      "driver earnings",
    ]);
  }

  let prev = 0;
  const prevPatterns = [
    /previous\s+weeks?'?\s+unpaid\s+earnings[^\d]{0,100}?\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /previous\s+weeks?'?\s+earnings[^\d]{0,100}?\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /unpaid\s+earnings[^\d]{0,100}?\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /from\s+prior\s+weeks?[^\d]{0,100}?\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /reported\s+from\s+prior[^\d]{0,100}?\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
  ];
  for (const re of prevPatterns) {
    const m = hay.match(re);
    if (m) {
      prev = parseNum(m[1]);
      break;
    }
  }
  earnings = Math.round((earnings + prev) * 100) / 100;

  let expenses = 0;
  const expPatterns = [
    /expenses,?\s+refunds,?\s+and\s+taxes[^\d]{0,140}?-\s*\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /expenses,?\s+refunds,?\s+and\s+taxes[^\d]{0,140}?\$\s*-\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /expenses,?\s+refunds[^\d]{0,160}?-\s*\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /refunds?\s+and\s+taxes[^\d]{0,140}?-\s*\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /total\s+fees[^\d]{0,100}?\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /uber\s+fees?[^\d]{0,100}?\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /service\s+fees?[^\d]{0,100}?\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /platform\s+fee[^\d]{0,100}?\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /d[ée]penses,?\s+remboursements[^\d]{0,120}?\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /frais\s+uber[^\d]{0,100}?\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
  ];
  for (const re of expPatterns) {
    const m = hay.match(re);
    if (m) {
      expenses = Math.abs(parseNum(m[1]));
      break;
    }
  }
  if (!expenses) {
    expenses = uberFindAfterKeywords(hay, [
      "expenses, refunds, and taxes",
      "expenses, refunds",
      "refunds and taxes",
      "total fees",
      "uber fees",
      "service fee",
    ]);
  }
  if (!expenses && /expenses,?\s+refunds/i.test(hayLo)) {
    const exIdx = hayLo.search(/expenses,?\s+refunds/i);
    const slice = hay.slice(exIdx, exIdx + 240);
    const neg = slice.match(/-\s*\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/);
    if (neg) expenses = Math.abs(parseNum(neg[1]));
    else {
      const pos = slice.match(/\$\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/);
      if (pos) expenses = Math.abs(parseNum(pos[1]));
    }
  }

  let total = 0;
  const totalPatterns = [
    /amount\s+transferred[^\d]{0,140}?\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /amount\s+paid\s+to\s+you[^\d]{0,140}?\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /net\s+payout[^\d]{0,100}?\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /total\s+payout[^\d]{0,100}?\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /paid\s+to\s+your[^\d]{0,140}?\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /deposit[^\d]{0,80}?\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
    /montant\s+vers[ée][^\d]{0,120}?\$?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))/i,
  ];
  for (const re of totalPatterns) {
    const m = hay.match(re);
    if (m) {
      total = parseNum(m[1]);
      break;
    }
  }
  if (!total) {
    total = uberFindAfterKeywords(hay, [
      "amount transferred",
      "net payout",
      "total payout",
      "amount paid to you",
      "you received",
      "paid to your",
      "payment to you",
    ]);
  }

let period_start = "";
  let period_end = "";
  const isoRange = hay.match(/(\d{4}-\d{2}-\d{2})\s*[-–]\s*(\d{4}-\d{2}-\d{2})/);
  if (isoRange) {
    period_start = isoRange[1];
    period_end = isoRange[2];
  } else {
    const usRange = hay.match(
      /(\d{1,2})\/(\d{1,2})\/(\d{4})\s*[-–]\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/
    );
    if (usRange) {
      period_start = `${usRange[3]}-${usRange[1].padStart(2, "0")}-${usRange[2].padStart(2, "0")}`;
      period_end = `${usRange[6]}-${usRange[4].padStart(2, "0")}-${usRange[5].padStart(2, "0")}`;
    } else {
      const mon = {
        jan: 1,
        feb: 2,
        mar: 3,
        apr: 4,
        may: 5,
        jun: 6,
        jul: 7,
        aug: 8,
        sep: 9,
        oct: 10,
        nov: 11,
        dec: 12,
      };
      const mr = hay.match(
        /(\w{3})\s+(\d{1,2}),?\s+(\d{4})\s*[-–]\s*(\w{3})\s+(\d{1,2}),?\s+(\d{4})/i
      );
      if (mr) {
        const m1 = mon[mr[1].toLowerCase().slice(0, 3)];
        const m2 = mon[mr[4].toLowerCase().slice(0, 3)];
        if (m1 && m2) {
          period_start = `${mr[3]}-${String(m1).padStart(2, "0")}-${String(mr[2]).padStart(2, "0")}`;
          period_end = `${mr[6]}-${String(m2).padStart(2, "0")}-${String(mr[5]).padStart(2, "0")}`;
        }
      }
    }
  }
  if (!period_end) period_end = new Date().toISOString().split("T")[0];
  if (!period_start) period_start = period_end;

  if (!total && earnings > 0 && expenses >= 0) {
    total = Math.round((earnings - expenses) * 100) / 100;
  }
  if (!earnings && total > 0 && expenses >= 0) {
    earnings = Math.round((total + expenses) * 100) / 100;
  }
  if (!expenses && earnings > 0 && total > 0 && earnings > total) {
    expenses = Math.round((earnings - total) * 100) / 100;
  }

  if (earnings === 0 && expenses === 0) {
    const fb = uberFallbackGrossNetFromAmounts(hay);
    if (fb) {
      earnings = fb.earnings;
      expenses = fb.expenses;
      total = fb.total;
    }
  }

  return { earnings, expenses, total, period_start, period_end };
}

function parseReceiptOcrText(raw) {
  const text = raw.replace(/\u00a0/g, " ");
  let amount = 0;
  const totalRe =
    /(?:TOTAL|TOTALE|TOT\.|AMOUNT\s+DUE|BALANCE|AMOUNT|TOPLAM)\s*[**:]*\s*\$?\s*([\d,]+\.?\d{0,2})/gi;
  const found = [];
  let m;
  while ((m = totalRe.exec(text)) !== null) found.push(parseNum(m[1]));
  if (found.length) amount = Math.max(...found);
  if (!amount) {
    const all = [...text.matchAll(/\$?\s*(\d{1,5}[.,]\d{2})\b/g)].map((x) => parseNum(x[1]));
    if (all.length) amount = all[all.length - 1];
  }
  let date = new Date().toISOString().split("T")[0];
  const ymd = text.match(/\b(\d{4})[/-](\d{2})[/-](\d{2})\b/);
  const dmy = text.match(/\b(\d{2})[/-](\d{2})[/-](\d{4})\b/);
  if (ymd) date = `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  else if (dmy) date = `${dmy[3]}-${dmy[1]}-${dmy[2]}`;

  const lower = text.toLowerCase();
  let category = "diger_gider";
  if (/uber|lyft|taxi/.test(lower)) category = "ulasim";
  else if (/walmart|costco|loblaws|metro|sobeys|canadian\s+tire/.test(lower)) category = "market";
  else if (/restaurant|cafe|tim\s*horton|mcdonald|starbucks/.test(lower)) category = "yemek";

  const line = text.split("\n").map((l) => l.trim()).find((l) => l.length > 3 && !/^\d+[.,]\d{2}$/.test(l));
  const desc = (line || "Fiş").slice(0, 80);

  return { amount, date, category, desc };
}

function fmt(n) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n || 0);
}

function getCat(type, id) {
  return CATEGORIES[type]?.find(c => c.id === id) || { label: id, icon: "📌", color: "#888" };
}

function normalizeTxDate(d) {
  if (d == null || d === "") return "";
  const s = String(d);
  return s.includes("T") ? s.slice(0, 10) : s;
}

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

function capitalizeWordsTr(s) {
  if (!s || typeof s !== "string") return "";
  return s.split(/\s+/).map((w) => {
    if (!w) return w;
    const lower = w.toLocaleLowerCase("tr-TR");
    return lower.charAt(0).toLocaleUpperCase("tr-TR") + lower.slice(1);
  }).join(" ");
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

export default function FinansApp() {
  const LS_KEY = "butcem_v4";
  const [transactions, setTransactions] = useState(() => {
    try {
      const s = localStorage.getItem(LS_KEY);
      if (s) return JSON.parse(s);
      const v2 = localStorage.getItem("butcem_v2");
      return v2 ? JSON.parse(v2) : [];
    } catch {
      return [];
    }
  });
  const [tab, setTab] = useState("dashboard");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
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
  const [reportMode, setReportMode] = useState("month");
  const [reportYear, setReportYear] = useState(() => new Date().getFullYear());
  const fileRef = useRef();
  const uberFileRef = useRef();

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(transactions));
    } catch {}
  }, [transactions]);

  useEffect(() => {
    if (!SHEETS_URL || !String(SHEETS_URL).includes("script.google.com")) return;
    const t = setTimeout(() => {
      const alive = transactions.filter((tx) => !tx.deleted);
      fetch(SHEETS_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sync",
          transactions,
          uberTransactions: alive.filter((tx) => tx.isUber),
          personalTransactions: alive.filter((tx) => !tx.isUber),
          sheetTargets: {
            all: "Tüm İşlemler",
            uber: "Uber İşlemler",
            personal: "Bireysel İşlemler",
          },
        }),
      }).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [transactions]);

  const showNotif = (msg, color = "#34C759") => {
    setNotification({ msg, color });
    setTimeout(() => setNotification(null), 3000);
  };

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
    const amt = parseFloat(String(form.amount).replace(",", ".").replace("$", ""));
    if (isNaN(amt) || amt <= 0) {
      showNotif("Geçerli bir tutar girin!", "#FF453A");
      return;
    }
    const isUber =
      form.category === "uber_gelir" || form.category === "uber_gider" ? true : !!form.isUber;
    const nowIso = new Date().toISOString();
    const newTx = {
      id: Date.now(),
      type: form.type,
      category: form.category,
      amount: amt,
      desc: form.desc || getCat(form.type, form.category).label,
      date: form.date,
      isUber,
      createdAt: nowIso,
      updatedAt: nowIso,
      deleted: false,
    };
    setTransactions((prev) => [newTx, ...prev]);
    setShowModal(false);
    setReceiptPreview(null);
    setForm({ ...EMPTY_FORM });
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
    const reader = new FileReader();
    reader.onload = async (ev) => {
      setReceiptPreview(ev.target.result);
      setOcrLoading(true);
      try {
        const { createWorker } = await import(
          /* @vite-ignore */
          "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/+esm"
        );
        const worker = await createWorker(["eng", "fra"], 1, { logger: () => {} });
        const {
          data: { text },
        } = await worker.recognize(ev.target.result);
        await worker.terminate();
        const parsed = parseReceiptOcrText(text);
        if (!parsed.amount || parsed.amount <= 0) throw new Error("Tutar yok");
        setForm((f) => ({
          ...f,
          type: "gider",
          amount: String(parsed.amount),
          desc: parsed.desc || "",
          category: parsed.category || "diger_gider",
          date: parsed.date || f.date,
          isUber: !!f.isUber,
        }));
        playBeep();
        showNotif("✅ Fiş okundu (OCR). Kontrol et ve ekle.");
      } catch {
        showNotif("Fiş okunamadı, manuel gir", "#FF9F0A");
      }
      setOcrLoading(false);
    };
    reader.readAsDataURL(file);
  };

  const pickPdfFile = (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
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
      const arrayBuffer = await file.arrayBuffer();
      const pdfText = await extractPdfTextFromBuffer(arrayBuffer);
      if (!pdfText || pdfText.replace(/\s/g, "").length < 25) {
        throw new Error(
          "PDF'de seçilebilir metin yok (taranmış görsel olabilir). Uygulamadan indirdiğin metin içeren ekstreyle deneyin."
        );
      }
      const { earnings, expenses, total, period_start, period_end } = parseUberStatementPlainText(pdfText);
      if (import.meta.env.DEV) console.log("[PDF] parse:", { earnings, expenses, total, period_start, period_end }, pdfText.slice(0, 800));
      if (earnings === 0 && expenses === 0) {
        throw new Error(
          "Kazanç veya gider satırı bulunamadı (ekstre şablonu veya dil farklı olabilir)."
        );
      }
      setUberResult({ earnings, expenses, total, period_start, period_end });
    } catch(err) {
      console.error("PDF hatası:", err.message);
      showNotif("PDF okunamadı: " + err.message, "#FF453A");
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
    showNotif(isUber ? "Uber verisi içe aktarıldı! ✓" : "PDF verisi (bireysel) içe aktarıldı! ✓");
  };

  const activeTxList = transactions.filter((t) => !t.deleted);
  const filteredTx = activeTxList.filter((t) => {
    const my = txMonthYear(t);
    return my && my.month === filterMonth && my.year === filterYear;
  });
  const filteredPersonalTx = filteredTx.filter((t) => !t.isUber);
  const filteredUberTx = filteredTx.filter((t) => t.isUber);
  const totalGelir = filteredTx.filter((t) => t.type === "gelir").reduce((s, t) => s + t.amount, 0);
  const totalGider = filteredTx.filter((t) => t.type === "gider").reduce((s, t) => s + t.amount, 0);
  const balance = totalGelir - totalGider;

  const giderByCat = {};
  filteredTx
    .filter((t) => t.type === "gider")
    .forEach((t) => {
      const cat = getCat("gider", t.category);
      if (!giderByCat[t.category]) giderByCat[t.category] = { name: cat.label, value: 0, color: cat.color, icon: cat.icon };
      giderByCat[t.category].value += t.amount;
    });
  const gelirByCat = {};
  filteredTx
    .filter((t) => t.type === "gelir")
    .forEach((t) => {
      const cat = getCat("gelir", t.category);
      if (!gelirByCat[t.category]) gelirByCat[t.category] = { name: cat.label, value: 0, color: cat.color, icon: cat.icon };
      gelirByCat[t.category].value += t.amount;
    });

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

  const sumType = (arr, typ) => arr.filter((x) => x.type === typ).reduce((s, x) => s + x.amount, 0);

  const monthlyUberBireysel = useMemo(() => {
    return Array.from({ length: 12 }, (_, mo) => {
      const txs = activeTxList.filter((t) => {
        const my = txMonthYear(t);
        return my && my.month === mo && my.year === reportYear;
      });
      const uber = txs.filter((t) => t.isUber);
      const br = txs.filter((t) => !t.isUber);
      const ug = sumType(uber, "gelir");
      const ud = sumType(uber, "gider");
      const bg = sumType(br, "gelir");
      const bd = sumType(br, "gider");
      return { mo, label: MONTHS[mo], uberGelir: ug, uberGider: ud, biGelir: bg, biGider: bd, net: ug + bg - ud - bd };
    });
  }, [activeTxList, reportYear]);

  const yearlyUberBireysel = useMemo(() => {
    const byY = {};
    activeTxList.forEach((t) => {
      const my = txMonthYear(t);
      if (!my) return;
      const y = my.year;
      if (!byY[y]) byY[y] = { uberGelir: 0, uberGider: 0, biGelir: 0, biGider: 0 };
      const amt = Number(t.amount) || 0;
      if (t.type === "gelir") {
        if (t.isUber) byY[y].uberGelir += amt;
        else byY[y].biGelir += amt;
      } else if (t.type === "gider") {
        if (t.isUber) byY[y].uberGider += amt;
        else byY[y].biGider += amt;
      }
    });
    return Object.keys(byY)
      .map(Number)
      .sort((a, b) => a - b)
      .map((y) => ({
        year: y,
        ...byY[y],
        net: byY[y].uberGelir + byY[y].biGelir - byY[y].uberGider - byY[y].biGider,
      }));
  }, [activeTxList]);

  const suggestions = getAISuggestions(activeTxList);
  const pieGiderData = Object.values(giderByCat);
  const pieGelirData = Object.values(gelirByCat);

  const openAdd = (type) => {
    setForm({
      ...EMPTY_FORM,
      type,
      category: type === "gelir" ? "uber_gelir" : "market",
      isUber: type === "gelir",
    });
    setReceiptPreview(null);
    setShowModal(true);
  };

  return (
    <div style={{minHeight:"100vh",background:"#000",color:"#fff",fontFamily:"'SF Pro Display',-apple-system,sans-serif",maxWidth:430,margin:"0 auto",position:"relative"}}>

      {notification && <div style={{position:"fixed",top:60,left:"50%",transform:"translateX(-50%)",background:notification.color,color:"#fff",padding:"10px 24px",borderRadius:20,fontSize:14,fontWeight:600,zIndex:9999,boxShadow:"0 4px 20px rgba(0,0,0,0.4)",whiteSpace:"nowrap"}}>{notification.msg}</div>}

      {/* Header */}
      <div style={{padding:"56px 20px 0",background:"linear-gradient(180deg,#1C1C1E 0%,#000 100%)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <div><div style={{fontSize:13,color:"#8E8E93"}}>Hoş geldin 👋</div><div style={{fontSize:22,fontWeight:700}}>Bütçem</div></div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <button type="button" onClick={pullFromSheet} disabled={pullingSheets} title="Sheet'ten çek" style={{background:"#2C2C2E",border:"none",color:"#0A84FF",borderRadius:10,padding:"6px 10px",fontSize:13,cursor:pullingSheets?"wait":"pointer",fontWeight:700}}>
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

      {/* Tabs */}
      <div style={{display:"flex",background:"#1C1C1E",padding:"0 6px",borderBottom:"1px solid #2C2C2E",overflowX:"auto"}}>
        {[{id:"dashboard",icon:"📊",label:"Özet"},{id:"personal",icon:"👤",label:"Özel"},{id:"uber",icon:"🚗",label:"Uber"},{id:"reports",icon:"📑",label:"Rapor"},{id:"charts",icon:"📈",label:"Grafik"},{id:"suggestions",icon:"🤖",label:"Öneri"}].map(t=>(
          <button type="button" key={t.id} onClick={()=>setTab(t.id)} style={{flex:1,minWidth:52,background:"none",border:"none",color:tab===t.id?"#0A84FF":"#8E8E93",padding:"10px 2px",fontSize:9,cursor:"pointer",fontWeight:tab===t.id?700:400,borderBottom:tab===t.id?"2px solid #0A84FF":"2px solid transparent",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
            <span style={{fontSize:15}}>{t.icon}</span>{t.label}
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
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                <thead>
                  <tr style={{background:"#2C2C2E",color:"#8E8E93",fontSize:10}}>
                    <th style={{padding:8,textAlign:"left"}}>Ay</th>
                    <th style={{padding:8,color:"#34C759"}}>Gelir</th>
                    <th style={{padding:8,color:"#FF453A"}}>Gider</th>
                    <th style={{padding:8}}>Net</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyData.map((row, idx) => (
                    <tr key={idx} style={{borderTop:"1px solid #2C2C2E",background:row.monthIndex===filterMonth&&row.year===filterYear?"#0A84FF10":"transparent"}}>
                      <td style={{padding:8,fontWeight:600}}>{row.name} {String(row.year).slice(2)}</td>
                      <td style={{padding:8,color:"#34C759"}}>{fmt(row.Gelir)}</td>
                      <td style={{padding:8,color:"#FF453A"}}>{fmt(row.Gider)}</td>
                      <td style={{padding:8,fontWeight:700,color:row.Net>=0?"#34C759":"#FF453A"}}>{row.Net>=0?"+":""}{fmt(row.Net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{fontSize:17,fontWeight:700,marginBottom:12}}>Son İşlemler</div>
            {filteredTx.slice(0,5).map(tx=>{
              const cat=getCat(tx.type,tx.category);
              return <div key={tx.id} style={{background:"#1C1C1E",borderRadius:14,padding:"12px 14px",marginBottom:8,display:"flex",alignItems:"center",gap:12}}>
                <div style={{width:42,height:42,borderRadius:12,background:cat.color+"25",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>{cat.icon}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:14,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tx.isUber&&<span style={{fontSize:10,background:"#E65100",borderRadius:6,padding:"1px 5px",marginRight:5}}>🚗</span>}{tx.desc||cat.label}</div>
                  <div style={{fontSize:12,color:"#8E8E93"}}>{tx.date} · {cat.label}</div>
                </div>
                <div style={{fontSize:15,fontWeight:700,color:tx.type==="gelir"?"#34C759":"#FF453A",flexShrink:0}}>{tx.type==="gelir"?"+":"-"}{fmt(tx.amount)}</div>
              </div>;
            })}
            {suggestions[0] && <div style={{background:"linear-gradient(135deg,#1C2D4A,#0A84FF20)",borderRadius:16,padding:16,marginTop:8,border:"1px solid #0A84FF30"}}><div style={{fontSize:12,color:"#0A84FF",fontWeight:700,marginBottom:6}}>🤖 AI ÖNERİSİ</div><div style={{fontSize:14,lineHeight:1.5,color:"#E5E5EA"}}>{suggestions[0].text}</div></div>}
          </div>
        )}

        {tab==="personal" && (
          <div>
            <div style={{fontSize:13,color:"#8E8E93",marginBottom:12}}>Bireysel (Uber dışı) — {MONTHS[filterMonth]} {filterYear}</div>
            {filteredPersonalTx.length===0 && <div style={{textAlign:"center",padding:40,color:"#8E8E93"}}><div style={{fontSize:40,marginBottom:12}}>👤</div><div>Bu ay bireysel kayıt yok</div></div>}
            {filteredPersonalTx.map(tx=>{
              const cat=getCat(tx.type,tx.category);
              return <div key={tx.id} style={{background:"#1C1C1E",borderRadius:14,padding:14,marginBottom:8,display:"flex",alignItems:"center",gap:12}}>
                <div style={{width:46,height:46,borderRadius:14,background:cat.color+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0,border:`1px solid ${cat.color}40`}}>{cat.icon}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:15,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{capitalizeWordsTr(tx.desc||cat.label)}</div>
                  <div style={{fontSize:12,color:"#8E8E93",marginTop:2}}>{tx.date} · {capitalizeWordsTr(cat.label)}</div>
                </div>
                <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6}}>
                  <div style={{fontSize:16,fontWeight:700,color:tx.type==="gelir"?"#34C759":"#FF453A"}}>{tx.type==="gelir"?"+":"-"}{fmt(tx.amount)}</div>
                  <button type="button" onClick={()=>setDeleteId(tx.id)} style={{background:"#FF453A20",border:"none",color:"#FF453A",borderRadius:8,padding:"3px 10px",fontSize:11,cursor:"pointer"}}>Sil</button>
                </div>
              </div>;
            })}
          </div>
        )}

        {tab==="uber" && (
          <div>
            <div style={{fontSize:13,color:"#8E8E93",marginBottom:12}}>Uber işi — {MONTHS[filterMonth]} {filterYear}</div>
            {filteredUberTx.length===0 && <div style={{textAlign:"center",padding:40,color:"#8E8E93"}}><div style={{fontSize:40,marginBottom:12}}>🚗</div><div>Bu ay Uber kaydı yok</div></div>}
            {filteredUberTx.map(tx=>{
              const cat=getCat(tx.type,tx.category);
              return <div key={tx.id} style={{background:"#1C1C1E",borderRadius:14,padding:14,marginBottom:8,display:"flex",alignItems:"center",gap:12,border:"1px solid #E6510030"}}>
                <div style={{width:46,height:46,borderRadius:14,background:cat.color+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0,border:`1px solid ${cat.color}40`}}>{cat.icon}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:15,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}><span style={{fontSize:10,background:"#E65100",borderRadius:6,padding:"1px 5px",marginRight:5}}>Uber</span>{capitalizeWordsTr(tx.desc||cat.label)}</div>
                  <div style={{fontSize:12,color:"#8E8E93",marginTop:2}}>{tx.date} · {capitalizeWordsTr(cat.label)}</div>
                </div>
                <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6}}>
                  <div style={{fontSize:16,fontWeight:700,color:tx.type==="gelir"?"#34C759":"#FF453A"}}>{tx.type==="gelir"?"+":"-"}{fmt(tx.amount)}</div>
                  <button type="button" onClick={()=>setDeleteId(tx.id)} style={{background:"#FF453A20",border:"none",color:"#FF453A",borderRadius:8,padding:"3px 10px",fontSize:11,cursor:"pointer"}}>Sil</button>
                </div>
              </div>;
            })}
          </div>
        )}

        {tab==="reports" && (
          <div>
            <div style={{fontSize:13,color:"#8E8E93",marginBottom:14,lineHeight:1.45}}>
              Gelir ve giderleri <strong style={{color:"#E65100"}}>Uber</strong> ile <strong style={{color:"#0A84FF"}}>bireysel</strong> olarak ayırarak görün. Google Sheet’te <strong>Özet Aylık</strong> ve <strong>Özet Yıllık</strong> sekmeleri de uygulama senkronuyla güncellenir.
            </div>
            <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
              <button type="button" onClick={()=>setReportMode("month")} style={{padding:"8px 14px",borderRadius:10,border:"none",background:reportMode==="month"?"#0A84FF":"#2C2C2E",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer"}}>Aylık</button>
              <button type="button" onClick={()=>setReportMode("year")} style={{padding:"8px 14px",borderRadius:10,border:"none",background:reportMode==="year"?"#0A84FF":"#2C2C2E",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer"}}>Yıllık</button>
              {reportMode==="month" && (
                <select value={reportYear} onChange={(e)=>setReportYear(Number(e.target.value))} style={{background:"#2C2C2E",color:"#fff",border:"none",borderRadius:10,padding:"8px 12px",fontSize:13,marginLeft:"auto"}}>
                  {[2022,2023,2024,2025,2026,2027,2028].map((y)=>(<option key={y} value={y}>{y}</option>))}
                </select>
              )}
            </div>
            {reportMode==="month" && (
              <div style={{background:"#1C1C1E",borderRadius:14,overflow:"auto",border:"1px solid #2C2C2E",marginBottom:12}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:10,minWidth:320}}>
                  <thead>
                    <tr style={{background:"#2C2C2E",color:"#8E8E93",textAlign:"left"}}>
                      <th style={{padding:8}}>Ay</th>
                      <th style={{padding:8,color:"#E65100"}}>Uber ↑</th>
                      <th style={{padding:8,color:"#E65100"}}>Uber ↓</th>
                      <th style={{padding:8,color:"#0A84FF"}}>Bir. ↑</th>
                      <th style={{padding:8,color:"#0A84FF"}}>Bir. ↓</th>
                      <th style={{padding:8}}>Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyUberBireysel.map((row) => (
                      <tr key={row.mo} style={{borderTop:"1px solid #2C2C2E"}}>
                        <td style={{padding:8,fontWeight:600}}>{row.label}</td>
                        <td style={{padding:8,color:"#34C759"}}>{fmt(row.uberGelir)}</td>
                        <td style={{padding:8,color:"#FF453A"}}>{fmt(row.uberGider)}</td>
                        <td style={{padding:8,color:"#34C759"}}>{fmt(row.biGelir)}</td>
                        <td style={{padding:8,color:"#FF453A"}}>{fmt(row.biGider)}</td>
                        <td style={{padding:8,fontWeight:700,color:row.net>=0?"#34C759":"#FF453A"}}>{row.net>=0?"+":""}{fmt(row.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {reportMode==="year" && (
              <div style={{background:"#1C1C1E",borderRadius:14,overflow:"auto",border:"1px solid #2C2C2E"}}>
                {yearlyUberBireysel.length===0 ? (
                  <div style={{padding:32,textAlign:"center",color:"#8E8E93"}}>Henüz yıllık veri yok</div>
                ) : (
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:10,minWidth:300}}>
                    <thead>
                      <tr style={{background:"#2C2C2E",color:"#8E8E93",textAlign:"left"}}>
                        <th style={{padding:8}}>Yıl</th>
                        <th style={{padding:8,color:"#E65100"}}>Uber ↑</th>
                        <th style={{padding:8,color:"#E65100"}}>Uber ↓</th>
                        <th style={{padding:8,color:"#0A84FF"}}>Bir. ↑</th>
                        <th style={{padding:8,color:"#0A84FF"}}>Bir. ↓</th>
                        <th style={{padding:8}}>Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {yearlyUberBireysel.map((row) => (
                        <tr key={row.year} style={{borderTop:"1px solid #2C2C2E"}}>
                          <td style={{padding:8,fontWeight:700}}>{row.year}</td>
                          <td style={{padding:8,color:"#34C759"}}>{fmt(row.uberGelir)}</td>
                          <td style={{padding:8,color:"#FF453A"}}>{fmt(row.uberGider)}</td>
                          <td style={{padding:8,color:"#34C759"}}>{fmt(row.biGelir)}</td>
                          <td style={{padding:8,color:"#FF453A"}}>{fmt(row.biGider)}</td>
                          <td style={{padding:8,fontWeight:700,color:row.net>=0?"#34C759":"#FF453A"}}>{row.net>=0?"+":""}{fmt(row.net)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
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
                        <div style={{fontSize:11,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.icon} {d.name}</div>
                        <div style={{fontSize:11,color:"#FF453A",fontWeight:600}}>{totalGider>0?Math.round((d.value/totalGider)*100):0}%</div>
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
                        <div style={{fontSize:12,flex:1}}>{d.icon} {d.name}</div>
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
              <button type="button" onClick={()=>setShowModal(false)} style={{background:"#2C2C2E",border:"none",color:"#fff",borderRadius:"50%",width:32,height:32,cursor:"pointer",fontSize:16}}>✕</button>
            </div>
            {form.type==="gelir" && (
              <div style={{fontSize:12,color:"#8E8E93",marginBottom:14,lineHeight:1.4}}>Varsayılan: Uber geliri. Maaş, freelance veya diğer iş geliri için kategori seçin; bunlar bireysel gelir olarak görünür.</div>
            )}

            {/* Type */}
            <div style={{display:"flex",background:"#2C2C2E",borderRadius:12,padding:4,marginBottom:16}}>
              {["gelir","gider"].map(t=>(
                <button type="button" key={t} onClick={()=>setForm(f=>({...f,type:t,category:t==="gelir"?"uber_gelir":"market",isUber:t==="gelir"}))} style={{flex:1,padding:8,border:"none",borderRadius:10,cursor:"pointer",background:form.type===t?(t==="gelir"?"#34C759":"#FF453A"):"transparent",color:"#fff",fontWeight:700,fontSize:14}}>
                  {t==="gelir"?"💚 Gelir":"🔴 Gider"}
                </button>
              ))}
            </div>

            {form.type==="gider" && (
              <div style={{marginBottom:12}}>
                <div style={{fontSize:13,color:"#8E8E93",marginBottom:8}}>Fiş kaydı: Uber mi, bireysel mi?</div>
                <div style={{display:"flex",gap:8}}>
                  <button type="button" onClick={()=>setForm(f=>({...f,isUber:true}))} style={{flex:1,padding:12,borderRadius:12,border:form.isUber?"2px solid #E65100":"2px solid #3A3A3C",background:form.isUber?"#E6510025":"#2C2C2E",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer"}}>🚗 Uber</button>
                  <button type="button" onClick={()=>setForm(f=>({...f,isUber:false}))} style={{flex:1,padding:12,borderRadius:12,border:!form.isUber?"2px solid #0A84FF":"2px solid #3A3A3C",background:!form.isUber?"#0A84FF22":"#2C2C2E",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer"}}>👤 Bireysel</button>
                </div>
              </div>
            )}
            <div style={{marginBottom:16}}>
              <div style={{fontSize:13,color:"#8E8E93",marginBottom:8}}>📷 Fiş (gider)</div>
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
                  <button type="button" key={cat.id} onClick={()=>setForm(f=>({...f,category:cat.id,isUber:cat.id.includes("uber")}))} style={{background:form.category===cat.id?cat.color+"30":"#2C2C2E",border:form.category===cat.id?`2px solid ${cat.color}`:"2px solid transparent",borderRadius:12,padding:"10px 4px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
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

      {showPdfUberChoice && pendingPdfFile && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:2100,display:"flex",alignItems:"center",justifyContent:"center",padding:24,backdropFilter:"blur(8px)"}} onClick={(e)=>{if(e.target===e.currentTarget){setShowPdfUberChoice(false);setPendingPdfFile(null);}}}>
          <div style={{background:"#1C1C1E",borderRadius:24,padding:24,maxWidth:380,width:"100%",border:"1px solid #3A3A3C"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:18,fontWeight:800,marginBottom:8}}>PDF türü</div>
            <div style={{fontSize:14,color:"#8E8E93",marginBottom:20,lineHeight:1.5}}>Bu PDF Uber haftalık ekstresi mi? İçe aktarılan satırlar Uber veya bireysel olarak işaretlenir.</div>
            <button type="button" onClick={()=>startPdfParse(true)} style={{width:"100%",marginBottom:10,background:"#E65100",border:"none",color:"#fff",borderRadius:14,padding:14,fontWeight:700,cursor:"pointer"}}>🚗 Evet, Uber ekstresi</button>
            <button type="button" onClick={()=>startPdfParse(false)} style={{width:"100%",marginBottom:10,background:"#2C2C2E",border:"1px solid #48484A",color:"#fff",borderRadius:14,padding:14,fontWeight:600,cursor:"pointer"}}>👤 Hayır, bireysel / diğer</button>
            <button type="button" onClick={()=>{setShowPdfUberChoice(false);setPendingPdfFile(null);}} style={{width:"100%",background:"transparent",border:"none",color:"#8E8E93",padding:10,cursor:"pointer"}}>Vazgeç</button>
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
                <div style={{color:"#8E8E93",fontSize:14}}>PDF metni okunuyor (sunucuya gönderilmez)</div>
              </div>
            ) : uberResult ? (
              <div>
                <div style={{fontSize:20,fontWeight:800,marginBottom:4}}>{uberImportIsUber ? "🚗 Uber Ekstre Özeti" : "📄 PDF özeti (bireysel)"}</div>
                <div style={{fontSize:13,color:"#8E8E93",marginBottom:20}}>{uberResult.period_start} → {uberResult.period_end}</div>
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
