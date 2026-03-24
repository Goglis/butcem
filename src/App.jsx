import { useState, useRef, useEffect } from "react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const SHEETS_URL = "https://script.google.com/macros/s/AKfycbwTVwsJDkvfFW5lI27Zo3i7p_PfjnCiHkhH8u8ztuaIBVowPQc0D4pZWnXXKJCfkEtTIw/exec";

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

const MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

const EMPTY_FORM = {
  type: "gider",
  category: "market",
  amount: "",
  desc: "",
  date: new Date().toISOString().split("T")[0],
  isUber: false
};

const fmt = (num) => {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0
  }).format(num || 0);
};

const getCategoryDetails = (type, id) => {
  return CATEGORIES[type]?.find(c => c.id === id) || { label: id, icon: "📌", color: "#888" };
};

export default function FinansApp() {
  const [transactions, setTransactions] = useState(() => {
    try {
      const saved = localStorage.getItem("butcem_v2");
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
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

  const fileInputRef = useRef();
  const uberFileInputRef = useRef();

  useEffect(() => {
    localStorage.setItem("butcem_v2", JSON.stringify(transactions));
  }, [transactions]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (transactions.length > 0) {
        fetch(SHEETS_URL, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "sync", transactions })
        }).catch(err => console.error("Sync error:", err));
      }
    }, 2000);
    return () => clearTimeout(timeout);
  }, [transactions]);

  const showNotif = (msg, color = "#34C759") => {
    setNotification({ msg, color });
    setTimeout(() => setNotification(null), 3000);
  };

  const handleAdd = () => {
    const amt = parseFloat(String(form.amount).replace(",", "."));
    if (isNaN(amt) || amt <= 0) {
      showNotif("Geçerli bir tutar girin!", "#FF453A");
      return;
    }

    const isUber = form.isUber || form.category.includes("uber");
    const newTx = {
      id: Date.now(),
      type: form.type,
      category: form.category,
      amount: amt,
      desc: form.desc || getCategoryDetails(form.type, form.category).label,
      date: form.date,
      isUber
    };

    setTransactions(prev => [newTx, ...prev]);
    setShowModal(false);
    setForm({ ...EMPTY_FORM });
    setReceiptPreview(null);
    showNotif(`${form.type === "gelir" ? "💚 Gelir" : "🔴 Gider"} başarıyla eklendi! ✓`);
  };

  const handleDelete = (id) => {
    setTransactions(prev => prev.filter(t => t.id !== id));
    setDeleteId(null);
    showNotif("İşlem silindi.", "#FF453A");
  };

  const handleReset = () => {
    setTransactions([]);
    localStorage.removeItem("butcem_v2");
    setResetStep(0);
    showNotif("Tüm veriler temizlendi!", "#FF453A");
  };

  const handleReceiptUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      setReceiptPreview(event.target.result);
      setOcrLoading(true);

      try {
        const base64 = event.target.result.split(",")[1];
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${import.meta.env.VITE_GEMINI_API_KEY}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [
                { inline_data: { mime_type: file.type || "image/jpeg", data: base64 } },
                { text: "Extract receipt info. Amount, description, category, and date. Category must be one of: market, yemek, faturalar, ulasim, saglik, eglence, giyim, egitim, kira, diger_gider. Date format: YYYY-MM-DD. Respond ONLY with JSON: {\"amount\": 12.50, \"desc\": \"Example Store\", \"category\": \"market\", \"date\": \"2026-03-22\"}" }
              ]
            }]
          })
        });

        const data = await res.json();
        const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const jsonMatch = textResponse.match(/\{.*\}/s);
        
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          setForm(prev => ({
            ...prev,
            type: "gider",
            amount: String(parsed.amount),
            desc: parsed.desc || "",
            category: parsed.category || "diger_gider",
            date: parsed.date || prev.date
          }));
          showNotif("✅ Fiş başarıyla analiz edildi!");
        }
      } catch (err) {
        showNotif("Fiş okuma hatası!", "#FF453A");
      } finally {
        setOcrLoading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleUberPDF = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUberLoading(true);
    setShowUberModal(true);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
      }
      const base64 = btoa(binary);

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${import.meta.env.VITE_GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: "application/pdf", data: base64 } },
              { text: "Extract from Uber statement: 1. Total Earnings (KAZANC), 2. Total Expenses/Fees (GIDER), 3. Total Payout (TOPLAM), 4. Period Start Date, 5. Period End Date. Respond ONLY in this format: KAZANC:123.45 GIDER:12.34 TOPLAM:111.11 START:2026-03-16 END:2026-03-23" }
            ]
          }]
        })
      });

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      
      const parseNum = (label) => {
        const regex = new RegExp(`${label}:([\\d.,]+)`, "i");
        const match = text.match(regex);
        return match ? parseFloat(match[1].replace(/,/g, "")) : 0;
      };

      const dateMatch = text.match(/END:(\d{4}-\d{2}-\d{2})/);
      const startMatch = text.match(/START:(\d{4}-\d{2}-\d{2})/);

      setUberResult({
        earnings: parseNum("KAZANC"),
        expenses: parseNum("GIDER"),
        total: parseNum("TOPLAM"),
        endDate: dateMatch ? dateMatch[1] : new Date().toISOString().split("T")[0],
        startDate: startMatch ? startMatch[1] : ""
      });

    } catch (err) {
      showNotif("PDF okuma hatası!", "#FF453A");
      setShowUberModal(false);
    } finally {
      setUberLoading(false);
    }
  };

  const confirmUberImport = (result) => {
    const timestamp = Date.now();
    const newTxs = [
      {
        id: timestamp,
        type: "gelir",
        category: "uber_gelir",
        amount: result.earnings,
        desc: `🚗 Uber Gelir (${result.startDate || ""})`,
        date: result.endDate,
        isUber: true
      },
      {
        id: timestamp + 1,
        type: "gider",
        category: "uber_gider",
        amount: result.expenses,
        desc: `🚗 Uber Kesinti/Gider (${result.startDate || ""})`,
        date: result.endDate,
        isUber: true
      }
    ];

    setTransactions(prev => [...newTxs, ...prev]);
    setShowUberModal(false);
    setUberResult(null);
    showNotif("Uber verileri içe aktarıldı! 🚗");
  };

  // İstatistiki verileri süz
  const filteredTransactions = transactions.filter(t => {
    const d = new Date(t.date + "T00:00:00");
    return d.getMonth() === filterMonth && d.getFullYear() === filterYear;
  });

  const totalGelir = filteredTransactions.filter(t => t.type === "gelir").reduce((sum, t) => sum + t.amount, 0);
  const totalGider = filteredTransactions.filter(t => t.type === "gider").reduce((sum, t) => sum + t.amount, 0);
  const netBakiye = totalGelir - totalGider;

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#000", color: "#fff", maxWidth: 43
