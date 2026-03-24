import { useState, useRef, useEffect, useMemo, useCallback } from "react";
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
    { id: "diger_gider", label: "Diğer Gider", icon: "#98989D" },
  ],
};

const MONTHS = ["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"];
const EMPTY_FORM = { type: "gider", category: "market", amount: "", desc: "", date: new Date().toISOString().split("T")[0], isUber: false };

// Helper: Currency Formatter (CAD)
const fmt = (n) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n || 0);

const getCat = (type, id) => CATEGORIES[type]?.find(c => c.id === id) || { label: id, icon: "📌", color: "#888" };

export default function FinansApp() {
  const [transactions, setTransactions] = useState(() => {
    try { const s = localStorage.getItem("butcem_v2"); return s ? JSON.parse(s) : []; } catch { return []; }
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
  
  const fileRef = useRef();
  const uberFileRef = useRef();

  // Save to LocalStorage
  useEffect(() => {
    localStorage.setItem("butcem_v2", JSON.stringify(transactions));
  }, [transactions]);

  // Sync to Sheets
  useEffect(() => {
    const t = setTimeout(() => {
      if (transactions.length > 0) {
        fetch(SHEETS_URL, { 
          method: "POST", 
          mode: "no-cors", 
          headers: { "Content-Type": "application/json" }, 
          body: JSON.stringify({ action: "sync", transactions }) 
        }).catch(err => console.error("Sync Error:", err));
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [transactions]);

  const showNotif = useCallback((msg, color = "#34C759") => { 
    setNotification({ msg, color }); 
    setTimeout(() => setNotification(null), 3000); 
  }, []);

  const handleAdd = () => {
    const amt = parseFloat(String(form.amount).replace(",", "."));
    if (isNaN(amt) || amt <= 0) { showNotif("Geçerli bir tutar girin!", "#FF453A"); return; }
    
    const isUber = form.isUber || form.category.includes("uber");
    const newTx = { 
      id: Date.now(), 
      type: form.type, 
      category: form.category, 
      amount: amt, 
      desc: form.desc || getCat(form.type, form.category).label, 
      date: form.date, 
      isUber 
    };

    setTransactions(prev => [newTx, ...prev]);
    setShowModal(false);
    setForm({...EMPTY_FORM});
    setReceiptPreview(null);
    showNotif(`${form.type === "gelir" ? "💚 Gelir" : "🔴 Gider"} eklendi ✓`);
  };

  const handleReceiptUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setOcrLoading(true);
    
    const reader = new FileReader();
    reader.onload = async (ev) => {
      setReceiptPreview(ev.target.result);
      try {
        const base64 = ev.target.result.split(",")[1];
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${import.meta.env.VITE_GEMINI_API_KEY}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [
              { inline_data: { mime_type: file.type, data: base64 } },
              { text: `Extract receipt info. Return JSON ONLY: {"amount": float, "desc": string, "category": "market"|"yemek"|"faturalar"|"ulasim"|"diger_gider", "date": "YYYY-MM-DD"}` }
            ]}]
          })
        });
        const data = await res.json();
        const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        const parsed = JSON.parse(jsonText.match(/\{.*\}/s)[0]);
        
        setForm(f => ({ ...f, amount: String(parsed.amount), desc: parsed.desc, category: parsed.category, date: parsed.date || f.date }));
        showNotif("✅ Fiş başarıyla okundu.");
      } catch (err) {
        showNotif("Fiş okunamadı, lütfen manuel girin.", "#FF9F0A");
      } finally {
        setOcrLoading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  // Data Filtering & Analytics
  const filteredTx = useMemo(() => transactions.filter(t => {
    const d = new Date(t.date + "T00:00:00"); // Edmonton local time fix
    return d.getMonth() === filterMonth && d.getFullYear() === filterYear;
  }), [transactions, filterMonth, filterYear]);

  const stats = useMemo(() => {
    const gelir = filteredTx.filter(t => t.type === "gelir").reduce((s, t) => s + t.amount, 0);
    const gider = filteredTx.filter(t => t.type === "gider").reduce((s, t) => s + t.amount, 0);
    return { gelir, gider, balance: gelir - gider };
  }, [filteredTx]);

  return (
    <div style={{ minHeight: "100vh", background: "#000", color: "#fff", maxWidth: 430, margin: "0 auto", position: "relative", paddingBottom: 100 }}>
      {/* Notification Toast */}
      {notification && (
        <div style={{ position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", background: notification.color, padding: "12px 24px", borderRadius: 25, zIndex: 10000, fontWeight: 600 }}>
          {notification.msg}
        </div>
      )}

      {/* Hero Section */}
      <div style={{ padding: "40px 20px 20px", background: "linear-gradient(180deg, #1C1C1E 0%, #000 100%)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
          <h2 style={{ margin: 0 }}>Bütçem</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <select value={filterMonth} onChange={e => setFilterMonth(Number(e.target.value))} style={{ background: "#2C2C2E", color: "#fff", border: "none", padding: 8, borderRadius: 8 }}>
              {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
          </div>
        </div>

        <div style={{ background: "linear-gradient(135deg, #0A84FF 0%, #0040DD 100%)", padding: 25, borderRadius: 20, boxShadow: "0 10px 30px rgba(10,132,255,0.3)" }}>
          <div style={{ opacity: 0.8, fontSize: 14 }}>Net Bakiye</div>
          <div style={{ fontSize: 36, fontWeight: 800, margin: "8px 0" }}>{fmt(stats.balance)}</div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 15, paddingTop: 15, borderTop: "1px solid rgba(255,255,255,0.2)" }}>
            <div><small>GELİR</small><div style={{ fontWeight: 700 }}>{fmt(stats.gelir)}</div></div>
            <div><small>GİDER</small><div style={{ fontWeight: 700 }}>{fmt(stats.gider)}</div></div>
          </div>
        </div>
      </div>

      {/* Tabs & List */}
      <div style={{ padding: 20 }}>
        {filteredTx.length === 0 ? (
          <div style={{ textAlign: "center", marginTop: 50, color: "#8E8E93" }}>Henüz işlem yok.</div>
        ) : (
          filteredTx.map(tx => (
            <div key={tx.id} style={{ background: "#1C1C1E", padding: 15, borderRadius: 15, marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 24 }}>{getCat(tx.type, tx.category).icon}</span>
                <div>
                  <div style={{ fontWeight: 600 }}>{tx.desc}</div>
                  <div style={{ fontSize: 12, color: "#8E8E93" }}>{tx.date}</div>
                </div>
              </div>
              <div style={{ fontWeight: 700, color: tx.type === "gelir" ? "#34C759" : "#FF453A" }}>
                {tx.type === "gelir" ? "+" : "-"}{fmt(tx.amount)}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Floating Action Buttons */}
      <div style={{ position: "fixed", bottom: 30, right: 20, display: "flex", flexDirection: "column", gap: 15 }}>
        <button onClick={() => { setForm({...EMPTY_FORM, type: "gelir"}); setShowModal(true); }} style={{ width: 60, height: 60, borderRadius: "50%", background: "#34C759", border: "none", color: "#fff", fontSize: 30, cursor: "pointer", boxShadow: "0 5px 15px rgba(52,199,89,0.4)" }}>+</button>
        <button onClick={() => { setForm({...EMPTY_FORM, type: "gider"}); setShowModal(true); }} style={{ width: 60, height: 60, borderRadius: "50%", background: "#FF453A", border: "none", color: "#fff", fontSize: 30, cursor: "pointer", boxShadow: "0 5px 15px rgba(255,69,58,0.4)" }}>-</button>
      </div>

      {/* Modal - Basitleştirilmiş Versiyon */}
      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "flex-end", zIndex: 999 }}>
          <div style={{ background: "#1C1C1E", width: "100%", padding: 25, borderRadius: "25px 25px 0 0", maxHeight: "90vh", overflowY: "auto" }}>
            <h3>{form.type === "gelir" ? "Gelir Ekle" : "Gider Ekle"}</h3>
            
            <button onClick={() => fileRef.current.click()} style={{ width: "100%", padding: 15, borderRadius: 12, background: "#2C2C2E", color: "#0A84FF", border: "1px dashed #0A84FF", marginBottom: 20 }}>
              {ocrLoading ? "Analiz ediliyor..." : "📸 Fiş Fotoğrafı Yükle"}
            </button>
            <input type="file" ref={fileRef} hidden onChange={handleReceiptUpload} />

            <input type="number" placeholder="Tutar (CAD)" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} style={{ width: "100%", padding: 15, marginBottom: 15, borderRadius: 10, background: "#2C2C2E", color: "#fff", border: "none", fontSize: 18 }} />
            <input type="text" placeholder="Açıklama" value={form.desc} onChange={e => setForm({...form, desc: e.target.value})} style={{ width: "100%", padding: 15, marginBottom: 15, borderRadius: 10, background: "#2C2C2E", color: "#fff", border: "none" }} />
            
            <select value={form.category} onChange={e => setForm({...form, category: e.target.value})} style={{ width: "100%", padding: 15, marginBottom: 25, borderRadius: 10, background: "#2C2C2E", color: "#fff", border: "none" }}>
              {CATEGORIES[form.type].map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
            </select>

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShowModal(false)} style={{ flex: 1, padding: 15, borderRadius: 12, background: "#3A3A3C", color: "#fff", border: "none" }}>İptal</button>
              <button onClick={handleAdd} style={{ flex: 2, padding: 15, borderRadius: 12, background: form.type === "gelir" ? "#34C759" : "#FF453A", color: "#fff", border: "none", fontWeight: 700 }}>Ekle</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
