import { useState, useRef, useEffect } from "react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid } from "recharts";

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
    { id: "ulasim", label: "Ulaşım", icon: "🚗", color: "#FF9F0A" },
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

const sampleData = []; // Örnek veri yok — gerçek verilerini gir!

function formatMoney(n) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n);
}

function getCategoryInfo(type, id) {
  return CATEGORIES[type]?.find(c => c.id === id) || { label: id, icon: "📌", color: "#888" };
}

function generateAISuggestions(transactions) {
  const suggestions = [];
  const now = new Date();
  const thisMonth = transactions.filter(t => {
    const d = new Date(t.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const totalGelir = thisMonth.filter(t => t.type === "gelir").reduce((s, t) => s + t.amount, 0);
  const totalGider = thisMonth.filter(t => t.type === "gider").reduce((s, t) => s + t.amount, 0);
  const balance = totalGelir - totalGider;

  const giderByCategory = {};
  thisMonth.filter(t => t.type === "gider").forEach(t => {
    giderByCategory[t.category] = (giderByCategory[t.category] || 0) + t.amount;
  });

  if (totalGider > totalGelir * 0.8) suggestions.push({ type: "warning", icon: "⚠️", text: "Bu ay giderleriniz gelirinizin %80'ini aştı. Tasarruf planı oluşturmanızı öneririz." });
  if (giderByCategory["yemek"] > totalGelir * 0.15) suggestions.push({ type: "tip", icon: "🍽️", text: `Yemek harcamalarınız (${formatMoney(giderByCategory["yemek"])}) oldukça yüksek. Evde yemek yaparak %40 tasarruf edebilirsiniz.` });
  if (giderByCategory["eglence"] > 500) suggestions.push({ type: "tip", icon: "🎬", text: "Eğlence harcamalarınızı gözden geçirin. Ücretsiz alternatifler deneyebilirsiniz." });
  if (balance > 0) suggestions.push({ type: "positive", icon: "🎯", text: `Aylık ${formatMoney(balance)} bütçe fazlanızı yatırıma yönlendirmeyi düşünün.` });
  if (balance > 3000) suggestions.push({ type: "positive", icon: "📈", text: "Acil durum fonu için gelirinizin %10'unu biriktime ayırmanızı öneririz." });
  if (!giderByCategory["saglik"]) suggestions.push({ type: "info", icon: "💊", text: "Bu ay sağlık harcaması görünmüyor. Düzenli check-up ihmal etmeyin." });

  return suggestions;
}

export default function FinansApp() {
  const [tab, setTab] = useState("dashboard");
  const [transactions, setTransactions] = useState(() => {
    try {
      const saved = localStorage.getItem("butcem_transactions");
      return saved ? JSON.parse(saved) : sampleData;
    } catch { return sampleData; }
  });
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState("gider");
  const [form, setForm] = useState({ type: "gider", category: "market", amount: "", desc: "", date: new Date().toISOString().split("T")[0], receipt: null, isUber: false });
  const [receiptPreview, setReceiptPreview] = useState(null);
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth());
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());
  const [deleteId, setDeleteId] = useState(null);
  const [resetStep, setResetStep] = useState(0); // 0=kapalı, 1=ilk onay, 2=son onay
  const [ocrLoading, setOcrLoading] = useState(false);
  const [notification, setNotification] = useState(null);
  const fileRef = useRef();
  const uberFileRef = useRef();
  const [uberLoading, setUberLoading] = useState(false);
  const [showUberModal, setShowUberModal] = useState(false);
  const [uberResult, setUberResult] = useState(null);

  const SHEETS_URL = "https://script.google.com/macros/s/AKfycbwTVwsJDkvfFW5lI27Zo3i7p_PfjnCiHkhH8u8ztuaIBVowPQc0D4pZWnXXKJCfkEtTIw/exec";

  const syncToSheets = async (action, data) => {
    try {
      await fetch(SHEETS_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...data }),
      });
    } catch (err) {
      console.log("Sheets sync hatası:", err);
    }
  };

  useEffect(() => {
    try { localStorage.setItem("butcem_transactions", JSON.stringify(transactions)); } catch {}
    syncToSheets("sync", { transactions });
  }, [transactions]);

  const showNotif = (msg, color = "#34C759") => {
    setNotification({ msg, color });
    setTimeout(() => setNotification(null), 3000);
  };

  const handleUberPDF = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUberLoading(true);
    setShowUberModal(true);
    setUberResult(null);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const base64 = ev.target.result.split(",")[1];
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${import.meta.env.VITE_GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { inline_data: { mime_type: "application/pdf", data: base64 } },
                  { text: `Bu bir Uber haftalık ekstre PDF. Sadece JSON yaz, başka hiçbir şey yazma:
{"earnings": <Kazançlarınız sayı>, "expenses": <Para İadeleri ve Giderler sayı>, "total": <Ödemeler sayı>, "period_start": "<YYYY-MM-DD>", "period_end": "<YYYY-MM-DD>"}` }
                ]
              }],
              generationConfig: { temperature: 0, maxOutputTokens: 1000 }
            })
          }
        );
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const clean = text.replace(/```json|```/g, "").trim();
        const jsonMatch = clean.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : clean);
        setUberResult(parsed);
      } catch(err) {
        showNotif("PDF okunamadı, tekrar dene", "#FF453A");
        setShowUberModal(false);
      }
      setUberLoading(false);
    };
    reader.readAsDataURL(file);
  };

  const confirmUberImport = (result) => {
    const newTxs = [];
    if (result.earnings > 0) {
      newTxs.push({
        id: Date.now(),
        type: "gelir",
        category: "uber_gelir",
        amount: result.earnings,
        desc: `🚗 Uber Kazanç (${result.period_start} - ${result.period_end})`,
        date: result.period_end,
        receipt: null,
        isUber: true,
      });
    }
    if (result.expenses > 0) {
      newTxs.push({
        id: Date.now() + 1,
        type: "gider",
        category: "uber_gider",
        amount: result.expenses,
        desc: `🚗 Uber Giderler (${result.period_start} - ${result.period_end})`,
        date: result.period_end,
        receipt: null,
        isUber: true,
      });
    }
    setTransactions(prev => [...newTxs, ...prev]);
    setShowUberModal(false);
    setUberResult(null);
    showNotif(`Uber verisi içe aktarıldı! ✓`);
  };

  const filteredTx = transactions.filter(t => {
    const d = new Date(t.date);
    return d.getMonth() === filterMonth && d.getFullYear() === filterYear;
  });

  const totalGelir = filteredTx.filter(t => t.type === "gelir").reduce((s, t) => s + t.amount, 0);
  const totalGider = filteredTx.filter(t => t.type === "gider").reduce((s, t) => s + t.amount, 0);
  const balance = totalGelir - totalGider;

  const giderByCategory = {};
  filteredTx.filter(t => t.type === "gider").forEach(t => {
    const cat = getCategoryInfo("gider", t.category);
    giderByCategory[t.category] = {
      name: cat.label,
      value: (giderByCategory[t.category]?.value || 0) + t.amount,
      color: cat.color,
      icon: cat.icon,
    };
  });

  const gelirByCategory = {};
  filteredTx.filter(t => t.type === "gelir").forEach(t => {
    const cat = getCategoryInfo("gelir", t.category);
    gelirByCategory[t.category] = {
      name: cat.label,
      value: (gelirByCategory[t.category]?.value || 0) + t.amount,
      color: cat.color,
      icon: cat.icon,
    };
  });

  const monthlyData = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (5 - i));
    const m = d.getMonth(), y = d.getFullYear();
    const txs = transactions.filter(t => {
      const td = new Date(t.date);
      return td.getMonth() === m && td.getFullYear() === y;
    });
    return {
      name: MONTHS[m],
      Gelir: txs.filter(t => t.type === "gelir").reduce((s, t) => s + t.amount, 0),
      Gider: txs.filter(t => t.type === "gider").reduce((s, t) => s + t.amount, 0),
    };
  });

  const suggestions = generateAISuggestions(transactions);

  const handleAdd = () => {
    const amt = parseFloat(String(form.amount).replace(",", "."));
    if (!form.amount || isNaN(amt) || amt <= 0) { 
      showNotif("Geçerli bir tutar girin!", "#FF453A"); 
      return; 
    }
    const newTx = { ...form, id: Date.now(), amount: amt };
    setTransactions(prev => [newTx, ...prev]);
    setShowModal(false);
    setReceiptPreview(null);
    setForm({ type: "gider", category: "market", amount: "", desc: "", date: new Date().toISOString().split("T")[0], receipt: null, isUber: false });
    showNotif(`${form.type === "gelir" ? "💚 Gelir" : "🔴 Gider"} eklendi ✓`);
  };

  const handleDelete = (id) => {
    setTransactions(prev => prev.filter(t => t.id !== id));
    setDeleteId(null);
    showNotif("Silindi", "#FF453A");
  };

  const handleReset = () => {
    setTransactions([]);
    try { localStorage.removeItem("butcem_transactions"); } catch {}
    syncToSheets("sync", { transactions: [] });
    setResetStep(0);
    showNotif("Tüm veriler silindi!", "#FF453A");
  };

  const handleReceiptUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Güvenli media type belirleme - telefon kamerası için
    let mediaType = file.type;
    if (!mediaType || mediaType === "application/octet-stream") {
      const name = file.name.toLowerCase();
      if (name.endsWith(".png")) mediaType = "image/png";
      else if (name.endsWith(".gif")) mediaType = "image/gif";
      else if (name.endsWith(".webp")) mediaType = "image/webp";
      else mediaType = "image/jpeg"; // default - telefon fotoğrafları genelde jpeg
    }
    // Desteklenmeyen tipler için jpeg'e çevir
    const supported = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!supported.includes(mediaType)) mediaType = "image/jpeg";

    const reader = new FileReader();
    reader.onload = async (ev) => {
      setReceiptPreview(ev.target.result);
      setOcrLoading(true);
      try {
        const base64 = ev.target.result.split(",")[1];
        if (!base64) throw new Error("Base64 okunamadı");

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${import.meta.env.VITE_GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { inline_data: { mime_type: mediaType, data: base64 } },
                  { text: `Fisteki toplam tutari, magaza adini, kategoriyi ve tarihi JSON olarak ver. Sadece su formati kullan:
{"amount":36.73,"desc":"Canadian Tire","category":"market","date":"2026-03-22"}
Kategori secenekleri: market, yemek, faturalar, ulasim, saglik, eglence, giyim, egitim, kira, diger_gider
Bugun: ${new Date().toISOString().split("T")[0]}
SADECE JSON YAZ, baska hicbir sey yazma.` }
                ]
              }],
              generationConfig: { temperature: 0, maxOutputTokens: 1000 }
            })
          }
        );
        if (!res.ok) { const e = await res.json(); throw new Error(e?.error?.message || "API hatası"); }
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        console.log("Gemini yanıtı:", text);
        const clean = text.replace(/```json|```/g, "").trim();
        const jsonMatch = clean.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("JSON bulunamadı: " + text);

        const parsed = JSON.parse(jsonMatch[0]);
        setForm(f => ({
          ...f,
          type: "gider",
          amount: String(parsed.amount || ""),
          desc: parsed.desc || "",
          category: parsed.category || "diger_gider",
          date: parsed.date || new Date().toISOString().split("T")[0],
        }));
        // Bip sesi çal
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = 880;
          osc.type = "sine";
          gain.gain.setValueAtTime(0.3, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.3);
        } catch(e) {}
        showNotif("✅ Fiş okundu! Kontrol et ve ekle.");
      } catch(err) {
        console.error("Fiş okuma hatası:", err);
        showNotif("Fiş okunamadı — manuel gir", "#FF9F0A");
      }
      setOcrLoading(false);
    };
    reader.onerror = () => {
      showNotif("Fotoğraf yüklenemedi", "#FF453A");
      setOcrLoading(false);
    };
    reader.readAsDataURL(file);
  };

  const pieGiderData = Object.values(giderByCategory);
  const pieGelirData = Object.values(gelirByCategory);

  return (
    <div style={{
      minHeight: "100vh",
      background: "#000",
      color: "#fff",
      fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif",
      maxWidth: 430,
      margin: "0 auto",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Notification */}
      {notification && (
        <div style={{
          position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)",
          background: notification.color, color: "#fff", padding: "10px 24px",
          borderRadius: 20, fontSize: 14, fontWeight: 600, zIndex: 9999,
          boxShadow: "0 4px 20px rgba(0,0,0,0.4)", animation: "fadeIn .3s",
        }}>{notification.msg}</div>
      )}

      {/* Header */}
      <div style={{ padding: "56px 20px 0", background: "linear-gradient(180deg, #1C1C1E 0%, #000 100%)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 13, color: "#8E8E93", marginBottom: 2 }}>Hoş geldin 👋</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>Bütçem</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={filterMonth} onChange={e => setFilterMonth(Number(e.target.value))}
              style={{ background: "#2C2C2E", color: "#fff", border: "none", borderRadius: 10, padding: "6px 10px", fontSize: 13 }}>
              {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
            <select value={filterYear} onChange={e => setFilterYear(Number(e.target.value))}
              style={{ background: "#2C2C2E", color: "#fff", border: "none", borderRadius: 10, padding: "6px 10px", fontSize: 13 }}>
              {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        {/* Balance Card */}
        <div style={{
          background: "linear-gradient(135deg, #1C1C2E 0%, #16213E 50%, #0F3460 100%)",
          borderRadius: 24, padding: "24px 20px", marginBottom: 16,
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 8px 32px rgba(0,122,255,0.15)",
        }}>
          <div style={{ fontSize: 13, color: "#8E8E93", marginBottom: 6 }}>Aylık Net Bakiye</div>
          <div style={{
            fontSize: 40, fontWeight: 800, letterSpacing: -1,
            color: balance >= 0 ? "#34C759" : "#FF453A",
          }}>{formatMoney(balance)}</div>
          <div style={{ display: "flex", gap: 20, marginTop: 20 }}>
            <div>
              <div style={{ fontSize: 11, color: "#8E8E93" }}>↑ GELİR</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#34C759" }}>{formatMoney(totalGelir)}</div>
            </div>
            <div style={{ width: 1, background: "rgba(255,255,255,0.1)" }} />
            <div>
              <div style={{ fontSize: 11, color: "#8E8E93" }}>↓ GİDER</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#FF453A" }}>{formatMoney(totalGider)}</div>
            </div>
            <div style={{ marginLeft: "auto" }}>
              <div style={{ fontSize: 11, color: "#8E8E93" }}>İŞLEM</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{filteredTx.length}</div>
            </div>
          </div>
          {totalGelir > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#8E8E93", marginBottom: 4 }}>
                <span>Harcama Oranı</span>
                <span>{Math.round((totalGider / totalGelir) * 100)}%</span>
              </div>
              <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: 4, height: 6 }}>
                <div style={{
                  width: `${Math.min((totalGider / totalGelir) * 100, 100)}%`,
                  background: totalGider / totalGelir > 0.8 ? "#FF453A" : "#34C759",
                  height: "100%", borderRadius: 4, transition: "width .5s"
                }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tab Bar */}
      <div style={{ display: "flex", background: "#1C1C1E", padding: "0 16px", borderBottom: "1px solid #2C2C2E" }}>
        {[
          { id: "dashboard", icon: "📊", label: "Özet" },
          { id: "transactions", icon: "📋", label: "İşlemler" },
          { id: "charts", icon: "📈", label: "Grafikler" },
          { id: "suggestions", icon: "🤖", label: "Öneriler" },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, background: "none", border: "none", color: tab === t.id ? "#0A84FF" : "#8E8E93",
            padding: "12px 0", fontSize: 11, cursor: "pointer", fontWeight: tab === t.id ? 700 : 400,
            borderBottom: tab === t.id ? "2px solid #0A84FF" : "2px solid transparent",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
          }}>
            <span style={{ fontSize: 18 }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: "16px 16px 100px", overflowY: "auto", maxHeight: "calc(100vh - 280px)" }}>

        {/* DASHBOARD TAB */}
        {tab === "dashboard" && (
          <div>
            {/* Quick Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              {[
                { label: "En Büyük Gider", value: Object.values(giderByCategory).sort((a,b)=>b.value-a.value)[0], type: "gider" },
                { label: "En Büyük Gelir", value: Object.values(gelirByCategory).sort((a,b)=>b.value-a.value)[0], type: "gelir" },
              ].map((s, i) => s.value ? (
                <div key={i} style={{ background: "#1C1C1E", borderRadius: 16, padding: 16 }}>
                  <div style={{ fontSize: 11, color: "#8E8E93", marginBottom: 8 }}>{s.label}</div>
                  <div style={{ fontSize: 22, marginBottom: 4 }}>{s.value.icon}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{s.value.name}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: s.type === "gider" ? "#FF453A" : "#34C759" }}>
                    {formatMoney(s.value.value)}
                  </div>
                </div>
              ) : null)}
            </div>

            {/* Recent Transactions */}
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 12 }}>Son İşlemler</div>
            {filteredTx.slice(0, 5).map(tx => {
              const cat = getCategoryInfo(tx.type, tx.category);
              return (
                <div key={tx.id} style={{
                  background: "#1C1C1E", borderRadius: 14, padding: "12px 14px",
                  marginBottom: 8, display: "flex", alignItems: "center", gap: 12,
                }}>
                  <div style={{
                    width: 42, height: 42, borderRadius: 12,
                    background: cat.color + "25", display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 20, flexShrink: 0,
                  }}>{cat.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {tx.desc || cat.label}
                    </div>
                    <div style={{ fontSize: 12, color: "#8E8E93" }}>{tx.date} · {cat.label}</div>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: tx.type === "gelir" ? "#34C759" : "#FF453A", flexShrink: 0 }}>
                    {tx.type === "gelir" ? "+" : "-"}{formatMoney(tx.amount)}
                  </div>
                </div>
              );
            })}

            {/* AI Tip */}
            {suggestions[0] && (
              <div style={{ background: "linear-gradient(135deg, #1C2D4A, #0A84FF20)", borderRadius: 16, padding: 16, marginTop: 8, border: "1px solid #0A84FF30" }}>
                <div style={{ fontSize: 12, color: "#0A84FF", fontWeight: 700, marginBottom: 6 }}>🤖 AI ÖNERİSİ</div>
                <div style={{ fontSize: 14, lineHeight: 1.5, color: "#E5E5EA" }}>{suggestions[0].text}</div>
              </div>
            )}
          </div>
        )}

        {/* TRANSACTIONS TAB */}
        {tab === "transactions" && (
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {["tümü", "gelir", "gider"].map(f => (
                <button key={f} style={{
                  background: "#2C2C2E", border: "none", color: "#fff", borderRadius: 20,
                  padding: "6px 14px", fontSize: 13, cursor: "pointer", textTransform: "capitalize"
                }}>{f === "tümü" ? "Tümü" : f === "gelir" ? "Gelirler" : "Giderler"} ({
                  f === "tümü" ? filteredTx.length : filteredTx.filter(t => t.type === f).length
                })</button>
              ))}
            </div>
            {filteredTx.length === 0 && (
              <div style={{ textAlign: "center", padding: 40, color: "#8E8E93" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
                <div>Bu ay henüz işlem yok</div>
              </div>
            )}
            {filteredTx.map(tx => {
              const cat = getCategoryInfo(tx.type, tx.category);
              return (
                <div key={tx.id} style={{
                  background: "#1C1C1E", borderRadius: 14, padding: "14px",
                  marginBottom: 8, display: "flex", alignItems: "center", gap: 12,
                }}>
                  <div style={{
                    width: 46, height: 46, borderRadius: 14,
                    background: cat.color + "22", display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 22, flexShrink: 0, border: `1px solid ${cat.color}40`,
                  }}>{cat.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {tx.isUber && <span style={{ fontSize: 11, background: "#E65100", borderRadius: 6, padding: "1px 6px", marginRight: 6 }}>🚗 Uber</span>}
                      {tx.desc || cat.label}
                    </div>
                    <div style={{ fontSize: 12, color: "#8E8E93", marginTop: 2 }}>{tx.date} · {cat.label}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: tx.type === "gelir" ? "#34C759" : "#FF453A" }}>
                      {tx.type === "gelir" ? "+" : "-"}{formatMoney(tx.amount)}
                    </div>
                    <button onClick={() => setDeleteId(tx.id)} style={{
                      background: "#FF453A20", border: "none", color: "#FF453A",
                      borderRadius: 8, padding: "3px 10px", fontSize: 11, cursor: "pointer"
                    }}>Sil</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* CHARTS TAB */}
        {tab === "charts" && (
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>6 Aylık Trend</div>
            <div style={{ background: "#1C1C1E", borderRadius: 20, padding: 16, marginBottom: 16 }}>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={monthlyData} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2C2C2E" />
                  <XAxis dataKey="name" tick={{ fill: "#8E8E93", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#8E8E93", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${v/1000}k` : v} />
                  <Tooltip formatter={(v) => formatMoney(v)} contentStyle={{ background: "#2C2C2E", border: "none", borderRadius: 12, color: "#fff" }} />
                  <Bar dataKey="Gelir" fill="#34C759" radius={[4,4,0,0]} />
                  <Bar dataKey="Gider" fill="#FF453A" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {pieGiderData.length > 0 && (
              <>
                <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>Gider Dağılımı</div>
                <div style={{ background: "#1C1C1E", borderRadius: 20, padding: 16, marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <ResponsiveContainer width="55%" height={180}>
                      <PieChart>
                        <Pie data={pieGiderData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" paddingAngle={3}>
                          {pieGiderData.map((d, i) => <Cell key={i} fill={d.color} />)}
                        </Pie>
                        <Tooltip formatter={(v) => formatMoney(v)} contentStyle={{ background: "#2C2C2E", border: "none", borderRadius: 12, color: "#fff" }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ flex: 1, paddingLeft: 8 }}>
                      {pieGiderData.sort((a,b)=>b.value-a.value).slice(0,5).map((d,i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: d.color, flexShrink: 0 }} />
                          <div style={{ fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.icon} {d.name}</div>
                          <div style={{ fontSize: 11, color: "#FF453A", fontWeight: 600, flexShrink: 0 }}>{Math.round((d.value/totalGider)*100)}%</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}

            {pieGelirData.length > 0 && (
              <>
                <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>Gelir Dağılımı</div>
                <div style={{ background: "#1C1C1E", borderRadius: 20, padding: 16, marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <ResponsiveContainer width="55%" height={150}>
                      <PieChart>
                        <Pie data={pieGelirData} cx="50%" cy="50%" innerRadius={35} outerRadius={60} dataKey="value" paddingAngle={3}>
                          {pieGelirData.map((d, i) => <Cell key={i} fill={d.color} />)}
                        </Pie>
                        <Tooltip formatter={(v) => formatMoney(v)} contentStyle={{ background: "#2C2C2E", border: "none", borderRadius: 12, color: "#fff" }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ flex: 1 }}>
                      {pieGelirData.map((d,i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: d.color, flexShrink: 0 }} />
                          <div style={{ fontSize: 12, flex: 1 }}>{d.icon} {d.name}</div>
                          <div style={{ fontSize: 12, color: "#34C759", fontWeight: 600 }}>{formatMoney(d.value)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* SUGGESTIONS TAB */}
        {tab === "suggestions" && (
          <div>
            <div style={{ background: "linear-gradient(135deg, #1C2D4A, #0A1628)", borderRadius: 20, padding: 20, marginBottom: 16, border: "1px solid #0A84FF30" }}>
              <div style={{ fontSize: 13, color: "#0A84FF", fontWeight: 700, marginBottom: 4 }}>🤖 AI FİNANS DANIŞMANI</div>
              <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Bütçe Analizi</div>
              <div style={{ fontSize: 14, color: "#8E8E93", lineHeight: 1.6 }}>
                {MONTHS[filterMonth]} {filterYear} dönemi için {filteredTx.length} işlem analiz edildi.
                {balance >= 0
                  ? ` Harika! ${formatMoney(balance)} fazla verdiniz.`
                  : ` Dikkat: ${formatMoney(Math.abs(balance))} açığınız var.`}
              </div>
            </div>

            {suggestions.length === 0 && (
              <div style={{ textAlign: "center", padding: 40, color: "#8E8E93" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
                <div>Tebrikler! Bütçeniz dengeli görünüyor.</div>
              </div>
            )}

            {suggestions.map((s, i) => (
              <div key={i} style={{
                background: s.type === "warning" ? "#FF453A15" : s.type === "positive" ? "#34C75915" : "#0A84FF10",
                border: `1px solid ${s.type === "warning" ? "#FF453A30" : s.type === "positive" ? "#34C75930" : "#0A84FF30"}`,
                borderRadius: 16, padding: 16, marginBottom: 12,
              }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>{s.icon}</div>
                <div style={{ fontSize: 14, lineHeight: 1.6, color: "#E5E5EA" }}>{s.text}</div>
              </div>
            ))}

            {/* Budget Goals */}
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 12, marginTop: 8 }}>💡 Bütçe Hedefleri</div>
            {[
              { label: "Tasarruf Hedefi (%20)", target: totalGelir * 0.2, current: balance },
              { label: "Gıda Limiti (%15)", target: totalGelir * 0.15, current: (giderByCategory["market"]?.value || 0) + (giderByCategory["yemek"]?.value || 0) },
              { label: "Eğlence Limiti (%5)", target: totalGelir * 0.05, current: giderByCategory["eglence"]?.value || 0 },
            ].map((g, i) => {
              const pct = totalGelir > 0 ? Math.min((g.current / g.target) * 100, 100) : 0;
              const over = g.current > g.target;
              return (
                <div key={i} style={{ background: "#1C1C1E", borderRadius: 14, padding: 14, marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{g.label}</div>
                    <div style={{ fontSize: 12, color: over ? "#FF453A" : "#34C759" }}>
                      {formatMoney(g.current)} / {formatMoney(g.target)}
                    </div>
                  </div>
                  <div style={{ background: "#2C2C2E", borderRadius: 4, height: 8 }}>
                    <div style={{ width: `${pct}%`, background: over ? "#FF453A" : "#34C759", height: "100%", borderRadius: 4, transition: "width .5s" }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* FAB Buttons */}
      <div style={{ position: "fixed", bottom: 24, right: 16, display: "flex", flexDirection: "column", gap: 10, zIndex: 100 }}>
        <input ref={uberFileRef} type="file" accept="application/pdf" onChange={handleUberPDF} style={{ display: "none" }} />
        <button onClick={() => setResetStep(1)} style={{
          width: 52, height: 52, borderRadius: "50%", background: "#3A3A3C", border: "none",
          color: "#fff", fontSize: 18, cursor: "pointer", boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>🗑️</button>
        <button onClick={() => uberFileRef.current.click()} style={{
          width: 52, height: 52, borderRadius: "50%", background: "#000", border: "2px solid #fff",
          color: "#fff", fontSize: 18, cursor: "pointer", boxShadow: "0 4px 20px rgba(255,255,255,0.2)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>🚗</button>
        <button onClick={() => { setForm(f => ({...f, type: "gelir", category: "maas"})); setShowModal(true); }} style={{
          width: 52, height: 52, borderRadius: "50%", background: "#34C759", border: "none",
          color: "#fff", fontSize: 22, cursor: "pointer", boxShadow: "0 4px 20px rgba(52,199,89,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>+</button>
        <button onClick={() => { setForm(f => ({...f, type: "gider", category: "market"})); setShowModal(true); }} style={{
          width: 52, height: 52, borderRadius: "50%", background: "#FF453A", border: "none",
          color: "#fff", fontSize: 22, cursor: "pointer", boxShadow: "0 4px 20px rgba(255,69,58,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>−</button>
      </div>

      {/* Add Modal */}
      {showModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000,
          display: "flex", alignItems: "flex-end", backdropFilter: "blur(10px)",
        }} onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div style={{
            background: "#1C1C1E", borderRadius: "24px 24px 0 0", padding: "20px 20px 40px",
            width: "100%", maxHeight: "90vh", overflowY: "auto",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 20, fontWeight: 700 }}>
                {form.type === "gelir" ? "💚 Gelir Ekle" : "🔴 Gider Ekle"}
              </div>
              <button onClick={() => setShowModal(false)} style={{ background: "#2C2C2E", border: "none", color: "#fff", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>

            {/* Type Toggle */}
            <div style={{ display: "flex", background: "#2C2C2E", borderRadius: 12, padding: 4, marginBottom: 16 }}>
              {["gelir","gider"].map(t => (
                <button key={t} onClick={() => setForm(f => ({...f, type: t, category: t === "gelir" ? "maas" : "market"}))} style={{
                  flex: 1, padding: "8px", border: "none", borderRadius: 10, cursor: "pointer",
                  background: form.type === t ? (t === "gelir" ? "#34C759" : "#FF453A") : "transparent",
                  color: "#fff", fontWeight: 700, fontSize: 14,
                }}>{t === "gelir" ? "💚 Gelir" : "🔴 Gider"}</button>
              ))}
            </div>

            {/* Receipt Upload */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: "#8E8E93", marginBottom: 8 }}>📷 Fiş Yükle (AI ile Otomatik Oku)</div>
              <input ref={fileRef} type="file" accept="image/*" onChange={handleReceiptUpload} style={{ display: "none" }} />
              <button onClick={() => fileRef.current.click()} style={{
                width: "100%", background: "#2C2C2E", border: "2px dashed #3A3A3C", borderRadius: 14,
                color: "#0A84FF", padding: 16, cursor: "pointer", fontSize: 14, fontWeight: 600,
              }}>
                {ocrLoading ? "⏳ Fiş Okunuyor..." : "📸 Fiş Fotoğrafı Çek veya Seç"}
              </button>
              {receiptPreview && <img src={receiptPreview} alt="fiş" style={{ width: "100%", borderRadius: 12, marginTop: 8, maxHeight: 150, objectFit: "cover" }} />}
            </div>

            {/* Amount */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: "#8E8E93", marginBottom: 6 }}>Tutar (₺)</div>
              <input value={form.amount} onChange={e => setForm(f => ({...f, amount: e.target.value}))}
                type="number" placeholder="0"
                style={{ width: "100%", background: "#2C2C2E", border: "none", borderRadius: 12, padding: "14px 16px", color: "#fff", fontSize: 22, fontWeight: 700, outline: "none", boxSizing: "border-box" }} />
            </div>

            {/* Description */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: "#8E8E93", marginBottom: 6 }}>Açıklama</div>
              <input value={form.desc} onChange={e => setForm(f => ({...f, desc: e.target.value}))}
                placeholder="İşlem açıklaması..."
                style={{ width: "100%", background: "#2C2C2E", border: "none", borderRadius: 12, padding: "12px 16px", color: "#fff", fontSize: 15, outline: "none", boxSizing: "border-box" }} />
            </div>

            {/* Category */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: "#8E8E93", marginBottom: 8 }}>Kategori</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                {CATEGORIES[form.type].map(cat => (
                  <button key={cat.id} onClick={() => setForm(f => ({...f, category: cat.id}))} style={{
                    background: form.category === cat.id ? cat.color + "30" : "#2C2C2E",
                    border: form.category === cat.id ? `2px solid ${cat.color}` : "2px solid transparent",
                    borderRadius: 12, padding: "10px 4px", cursor: "pointer",
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                  }}>
                    <span style={{ fontSize: 20 }}>{cat.icon}</span>
                    <span style={{ fontSize: 10, color: "#fff", textAlign: "center" }}>{cat.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Date */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, color: "#8E8E93", marginBottom: 6 }}>Tarih</div>
              <input type="date" value={form.date} onChange={e => setForm(f => ({...f, date: e.target.value}))}
                style={{ width: "100%", background: "#2C2C2E", border: "none", borderRadius: 12, padding: "12px 16px", color: "#fff", fontSize: 15, outline: "none", boxSizing: "border-box" }} />
            </div>

            {/* Uber Toggle */}
            <div style={{ marginBottom: 16 }}>
              <button onClick={() => setForm(f => ({...f, isUber: !f.isUber}))} style={{
                width: "100%", background: form.isUber ? "#E65100" : "#2C2C2E",
                border: form.isUber ? "2px solid #FF6D00" : "2px solid transparent",
                borderRadius: 14, padding: 14, color: "#fff", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                fontSize: 15, fontWeight: 700,
              }}>
                <span style={{ fontSize: 22 }}>🚗</span>
                {form.isUber ? "✅ Uber İşlemi (İş)" : "Uber İşlemi mi? (İş Gideri/Geliri)"}
              </button>
              {form.isUber && (
                <div style={{ fontSize: 12, color: "#FF9F0A", textAlign: "center", marginTop: 6 }}>
                  Bu işlem Uber tablosuna ayrıca kaydedilecek
                </div>
              )}
            </div>

            <button onClick={handleAdd} style={{
              width: "100%", background: form.type === "gelir" ? "#34C759" : "#FF453A",
              border: "none", borderRadius: 16, padding: 18, color: "#fff",
              fontSize: 17, fontWeight: 700, cursor: "pointer",
              boxShadow: `0 4px 20px ${form.type === "gelir" ? "rgba(52,199,89,0.4)" : "rgba(255,69,58,0.4)"}`,
            }}>
              {form.type === "gelir" ? "💚 Gelir Ekle" : "🔴 Gider Ekle"}
            </button>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteId && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: "#1C1C1E", borderRadius: 20, padding: 24, width: "100%" }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>İşlemi Sil</div>
            <div style={{ color: "#8E8E93", marginBottom: 20 }}>Bu işlemi silmek istediğinden emin misin?</div>
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={() => setDeleteId(null)} style={{ flex: 1, background: "#2C2C2E", border: "none", color: "#fff", borderRadius: 12, padding: 14, cursor: "pointer", fontWeight: 600 }}>İptal</button>
              <button onClick={() => handleDelete(deleteId)} style={{ flex: 1, background: "#FF453A", border: "none", color: "#fff", borderRadius: 12, padding: 14, cursor: "pointer", fontWeight: 600 }}>Sil</button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Modal - Adım 1 */}
      {resetStep === 1 && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, backdropFilter: "blur(10px)" }}>
          <div style={{ background: "#1C1C1E", borderRadius: 24, padding: 28, width: "100%", border: "1px solid #FF453A40" }}>
            <div style={{ fontSize: 48, textAlign: "center", marginBottom: 16 }}>⚠️</div>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8, textAlign: "center" }}>Tüm Verileri Sil?</div>
            <div style={{ color: "#8E8E93", marginBottom: 24, textAlign: "center", lineHeight: 1.6 }}>
              Tüm işlemler, gelir ve gider kayıtları silinecek. Bu işlem geri alınamaz!
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={() => setResetStep(0)} style={{ flex: 1, background: "#2C2C2E", border: "none", color: "#fff", borderRadius: 12, padding: 14, cursor: "pointer", fontWeight: 600 }}>İptal</button>
              <button onClick={() => setResetStep(2)} style={{ flex: 1, background: "#FF453A", border: "none", color: "#fff", borderRadius: 12, padding: 14, cursor: "pointer", fontWeight: 700 }}>Devam Et</button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Modal - Adım 2 (Son Onay) */}
      {resetStep === 2 && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, backdropFilter: "blur(10px)" }}>
          <div style={{ background: "#1C1C1E", borderRadius: 24, padding: 28, width: "100%", border: "1px solid #FF453A60" }}>
            <div style={{ fontSize: 48, textAlign: "center", marginBottom: 16 }}>🚨</div>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8, textAlign: "center", color: "#FF453A" }}>EMIN MİSİN?</div>
            <div style={{ color: "#8E8E93", marginBottom: 8, textAlign: "center", lineHeight: 1.6 }}>
              Bu işlem <span style={{ color: "#FF453A", fontWeight: 700 }}>GERİ ALINAMAZ!</span>
            </div>
            <div style={{ color: "#8E8E93", marginBottom: 24, textAlign: "center", fontSize: 13 }}>
              Tüm işlemler hem uygulamadan hem Google Sheets'ten silinecek.
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={() => setResetStep(0)} style={{ flex: 1, background: "#2C2C2E", border: "none", color: "#fff", borderRadius: 12, padding: 14, cursor: "pointer", fontWeight: 600 }}>Vazgeç</button>
              <button onClick={handleReset} style={{ flex: 1, background: "#FF453A", border: "2px solid #FF6B6B", color: "#fff", borderRadius: 12, padding: 14, cursor: "pointer", fontWeight: 800, fontSize: 15 }}>🗑️ Evet, Sil!</button>
            </div>
          </div>
        </div>
      )}

      {/* Uber PDF Modal */}
      {showUberModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, backdropFilter: "blur(10px)" }}>
          <div style={{ background: "#1C1C1E", borderRadius: 24, padding: 28, width: "100%", border: "1px solid #3A3A3C" }}>
            {uberLoading ? (
              <div style={{ textAlign: "center", padding: 20 }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🚗</div>
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>PDF Okunuyor...</div>
                <div style={{ color: "#8E8E93", fontSize: 14 }}>AI Uber ekstrenizi analiz ediyor</div>
                <div style={{ marginTop: 20, display: "flex", justifyContent: "center", gap: 6 }}>
                  {[0,1,2].map(i => (
                    <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: "#0A84FF", animation: `pulse ${0.6 + i * 0.2}s infinite alternate` }} />
                  ))}
                </div>
              </div>
            ) : uberResult ? (
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>🚗 Uber Ekstre Özeti</div>
                <div style={{ fontSize: 13, color: "#8E8E93", marginBottom: 20 }}>{uberResult.period_start} → {uberResult.period_end}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
                  <div style={{ background: "#34C75915", border: "1px solid #34C75930", borderRadius: 14, padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 12, color: "#8E8E93" }}>💚 NET KAZANÇ</div>
                      <div style={{ fontSize: 11, color: "#8E8E93", marginTop: 2 }}>Gelir olarak eklenecek</div>
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#34C759" }}>CA${uberResult.earnings?.toFixed(2)}</div>
                  </div>
                  <div style={{ background: "#FF453A15", border: "1px solid #FF453A30", borderRadius: 14, padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 12, color: "#8E8E93" }}>🔴 GİDERLER</div>
                      <div style={{ fontSize: 11, color: "#8E8E93", marginTop: 2 }}>Gider olarak eklenecek</div>
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#FF453A" }}>CA${uberResult.expenses?.toFixed(2)}</div>
                  </div>
                  <div style={{ background: "#0A84FF15", border: "1px solid #0A84FF30", borderRadius: 14, padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 12, color: "#8E8E93" }}>💳 TOPLAM ÖDEME</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#0A84FF" }}>CA${uberResult.total?.toFixed(2)}</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <button onClick={() => { setShowUberModal(false); setUberResult(null); }} style={{ flex: 1, background: "#2C2C2E", border: "none", color: "#fff", borderRadius: 12, padding: 14, cursor: "pointer", fontWeight: 600 }}>İptal</button>
                  <button onClick={() => confirmUberImport(uberResult)} style={{ flex: 2, background: "#34C759", border: "none", color: "#fff", borderRadius: 12, padding: 14, cursor: "pointer", fontWeight: 700, fontSize: 15 }}>✅ İçe Aktar</button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateX(-50%) translateY(-10px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
        @keyframes pulse { from { opacity: 0.3; transform: scale(0.8); } to { opacity: 1; transform: scale(1.2); } }
        * { -webkit-tap-highlight-color: transparent; }
        input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(1); }
      `}</style>
    </div>
  );
}
