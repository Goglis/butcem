import { useState, useRef, useEffect, useMemo } from "react";
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

const MONTHS = ["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"];
const EMPTY_FORM = { type: "gider", category: "market", amount: "", desc: "", date: new Date().toISOString().split("T")[0], isUber: false };

function fmt(n) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n || 0);
}

function getCat(type, id) {
  return CATEGORIES[type]?.find(c => c.id === id) || { label: id, icon: "📌", color: "#888" };
}

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

  useEffect(() => {
    localStorage.setItem("butcem_v2", JSON.stringify(transactions));
  }, [transactions]);

  useEffect(() => {
    const t = setTimeout(() => {
      fetch(SHEETS_URL, { method: "POST", mode: "no-cors", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync", transactions }) }).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [transactions]);

  const showNotif = (msg, color = "#34C759") => { setNotification({ msg, color }); setTimeout(() => setNotification(null), 3000); };

  const handleAdd = () => {
    const amt = parseFloat(String(form.amount).replace(",",".").replace("$",""));
    if (isNaN(amt) || amt <= 0) { showNotif("Geçerli bir tutar girin!", "#FF453A"); return; }
    const isUber = form.isUber || form.category.includes("uber");
    const newTx = { id: Date.now(), type: form.type, category: form.category, amount: amt, desc: form.desc || getCat(form.type, form.category).label, date: form.date, isUber };
    setTransactions(prev => [newTx, ...prev]);
    setShowModal(false); setForm({...EMPTY_FORM}); setReceiptPreview(null);
    showNotif(`${form.type === "gelir" ? "💚 Gelir" : "🔴 Gider"} eklendi ✓`);
  };

  const handleDelete = (id) => { setTransactions(prev => prev.filter(t => t.id !== id)); setDeleteId(null); showNotif("Silindi", "#FF453A"); };

  const handleReset = () => { setTransactions([]); localStorage.removeItem("butcem_v2"); setResetStep(0); showNotif("Tüm veriler silindi!", "#FF453A"); };

  const handleReceiptUpload = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      setReceiptPreview(ev.target.result); setOcrLoading(true);
      try {
        const base64 = ev.target.result.split(",")[1];
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${import.meta.env.VITE_GEMINI_API_KEY}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: file.type || "image/jpeg", data: base64 } }, { text: `Extract amount, desc, category, date from receipt. Category must be one of: market, yemek, faturalar, ulasim, saglik, eglence, giyim, egitim, kira, diger_gider. Return ONLY JSON: {"amount":36.73,"desc":"Canadian Tire","category":"market","date":"2026-03-22"}` }] }] })
        });
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const parsed = JSON.parse(text.match(/\{.*\}/s)[0]);
        setForm(f => ({ ...f, type: "gider", amount: String(parsed.amount), desc: parsed.desc || "", category: parsed.category || "diger_gider", date: parsed.date || f.date }));
        showNotif("✅ Fiş okundu!");
      } catch { showNotif("Fiş okunamadı", "#FF9F0A"); }
      setOcrLoading(false);
    };
    reader.readAsDataURL(file);
  };

  const handleUberPDF = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setUberLoading(true); setShowUberModal(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = ""; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const base64 = btoa(binary);

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${import.meta.env.VITE_GEMINI_API_KEY}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: "application/pdf", data: base64 } }, { text: `Uber statement PDF. Extract: KAZANC, GIDER, TOPLAM, BASLANGIC(YYYY-MM-DD), BITIS(YYYY-MM-DD). Format: KAZANC:945.95 GIDER:66.27 TOPLAM:1017.14 BASLANGIC:2026-03-16 BITIS:2026-03-23` }] }] })
      });
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      
      const parseNum = (s) => parseFloat(s?.replace(",", "") || 0);
      const k = text.match(/KAZANC:([\d.,]+)/i);
      const g = text.match(/GIDER:([\d.,]+)/i);
      const s = text.match(/BASLANGIC:(\d{4}-\d{2}-\d{2})/i);
      const e = text.match(/BITIS:(\d{4}-\d{2}-\d{2})/i);

      setUberResult({ earnings: parseNum(k?.[1]), expenses: parseNum(g?.[1]), period_start: s?.[1], period_end: e?.[1] });
    } catch { showNotif("PDF hatası", "#FF453A"); setShowUberModal(false); }
    setUberLoading(false);
  };

  const confirmUberImport = (res) => {
    const t = Date.now();
    const newTxs = [
      { id: t, type: "gelir", category: "uber_gelir", amount: res.earnings, desc: `🚗 Uber Kazanç (${res.period_start})`, date: res.period_end, isUber: true },
      { id: t+1, type: "gider", category: "uber_gider", amount: res.expenses, desc: `🚗 Uber Gider (${res.period_start})`, date: res.period_end, isUber: true }
    ];
    setTransactions(prev => [...newTxs, ...prev]);
    setShowUberModal(false); showNotif("Uber verisi eklendi!");
  };

  // Analytics
  const filteredTx = useMemo(() => transactions.filter(t => {
    const d = new Date(t.date + "T00:00:00");
    return d.getMonth() === filterMonth && d.getFullYear() === filterYear;
  }), [transactions, filterMonth, filterYear]);

  const totalGelir = filteredTx.filter(t => t.type==="gelir").reduce((s,t) => s+t.amount, 0);
  const totalGider = filteredTx.filter(t => t.type==="gider").reduce((s,t) => s+t.amount, 0);
  const balance = totalGelir - totalGider;

  const giderByCat = useMemo(() => {
    const obj = {};
    filteredTx.filter(t => t.type==="gider").forEach(t => {
      const cat = getCat("gider", t.category);
      if (!obj[t.category]) obj[t.category] = { name: cat.label, value: 0, color: cat.color, icon: cat.icon };
      obj[t.category].value += t.amount;
    });
    return Object.values(obj).sort((a,b) => b.value - a.value);
  }, [filteredTx]);

  const suggestions = useMemo(() => {
    const s = [];
    if (totalGider > totalGelir * 0.8 && totalGelir > 0) s.push({ type: "warning", icon: "⚠️", text: "Giderleriniz gelirinizin %80'ini aştı!" });
    if (balance > 1000) s.push({ type: "positive", icon: "📈", text: "Bu ay güzel bir tasarruf yaptınız, yatırıma yönlendirin." });
    return s;
  }, [totalGelir, totalGider, balance]);

  return (
    <div style={{minHeight:"100vh",background:"#000",color:"#fff",maxWidth:430,margin:"0 auto",position:"relative",paddingBottom:120, overflowX:"hidden"}}>
      {notification && <div style={{position:"fixed",top:20,left:"50%",transform:"translateX(-50%)",background:notification.color,padding:"10px 20px",borderRadius:20,zIndex:9999}}>{notification.msg}</div>}

      {/* Header */}
      <div style={{padding:"50px 20px 20px",background:"#1C1C1E"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <h2 style={{margin:0}}>Bütçem</h2>
          <div style={{display:"flex",gap:5}}>
            <select value={filterMonth} onChange={e=>setFilterMonth(Number(e.target.value))} style={{background:"#2C2C2E",color:"#fff",border:"none",padding:5,borderRadius:8}}>
              {MONTHS.map((m,i)=><option key={i} value={i}>{m}</option>)}
            </select>
          </div>
        </div>
        <div style={{background:"linear-gradient(135deg,#1C2D4A,#0A84FF)",padding:20,borderRadius:20}}>
          <div style={{fontSize:14,opacity:0.8}}>Net Durum</div>
          <div style={{fontSize:32,fontWeight:800}}>{fmt(balance)}</div>
          <div style={{display:"flex",justifyContent:"space-between",marginTop:15}}>
            <span>Gelir: {fmt(totalGelir)}</span>
            <span>Gider: {fmt(totalGider)}</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",background:"#1C1C1E",marginBottom:15,borderBottom:"1px solid #2C2C2E"}}>
        {["dashboard","transactions","charts","suggestions"].map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:15,background:"none",border:"none",color:tab===t?"#0A84FF":"#8E8E93",borderBottom:tab===t?"2px solid #0A84FF":"none",textTransform:"capitalize"}}>{t}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{padding:"0 15px"}}>
        {tab==="dashboard" && (
          <div>
            <h3>Son İşlemler</h3>
            {filteredTx.slice(0,5).map(tx => (
              <div key={tx.id} style={{background:"#1C1C1E",padding:12,borderRadius:12,marginBottom:8,display:"flex",justifyContent:"space-between"}}>
                <div style={{display:"flex",gap:10}}>
                  <span>{getCat(tx.type, tx.category).icon}</span>
                  <div>{tx.desc}</div>
                </div>
                <div style={{color:tx.type==="gelir"?"#34C759":"#FF453A"}}>{fmt(tx.amount)}</div>
              </div>
            ))}
          </div>
        )}

        {tab==="transactions" && (
           <div>
             {filteredTx.map(tx => (
               <div key={tx.id} style={{background:"#1C1C1E",padding:12,borderRadius:12,marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                 <div>
                    <div style={{fontWeight:600}}>{tx.isUber && "🚗 "}{tx.desc}</div>
                    <div style={{fontSize:12,color:"#8E8E93"}}>{tx.date}</div>
                 </div>
                 <button onClick={()=>setDeleteId(tx.id)} style={{background:"#FF453A20",color:"#FF453A",border:"none",padding:"5px 10px",borderRadius:8}}>Sil</button>
               </div>
             ))}
           </div>
        )}

        {tab==="charts" && (
          <div style={{height:300, background:"#1C1C1E", borderRadius:20, padding:15}}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={giderByCat} dataKey="value" innerRadius={60} outerRadius={80} paddingAngle={5}>
                  {giderByCat.map((d,i)=><Cell key={i} fill={d.color}/>)}
                </Pie>
                <Tooltip/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {tab==="suggestions" && (
          <div>
            {suggestions.map((s,i)=>(
              <div key={i} style={{background:"#1C1C1E",padding:15,borderRadius:15,borderLeft:`4px solid ${s.type==="warning"?"#FF453A":"#34C759"}`,marginBottom:10}}>
                {s.icon} {s.text}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* FABs */}
      <div style={{position:"fixed",bottom:20,right:20,display:"flex",flexDirection:"column",gap:10}}>
        <button onClick={()=>setResetStep(1)} style={{width:50,height:50,borderRadius:25,background:"#3A3A3C",border:"none"}}>🗑️</button>
        <button onClick={()=>uberFileRef.current.click()} style={{width:50,height:50,borderRadius:25,background:"#E65100",border:"none"}}>🚗</button>
        <button onClick={()=>{setShowModal(true); setForm({...EMPTY_FORM, type:"gelir"})}} style={{width:60,height:60,borderRadius:30,background:"#34C759",border:"none",fontSize:24}}>+</button>
        <button onClick={()=>{setShowModal(true); setForm({...EMPTY_FORM, type:"gider"})}} style={{width:60,height:60,borderRadius:30,background:"#FF453A",border:"none",fontSize:24}}>−</button>
      </div>

      <input ref={uberFileRef} type="file" hidden accept="application/pdf" onChange={handleUberPDF}/>

      {/* Add Modal */}
      {showModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",zIndex:1000,display:"flex",alignItems:"flex-end"}}>
          <div style={{background:"#1C1C1E",width:"100%",padding:20,borderRadius:"20px 20px 0 0"}}>
            <button onClick={()=>fileRef.current.click()} style={{width:"100%",padding:15,borderRadius:12,border:"1px dashed #0A84FF",background:"none",color:"#0A84FF",marginBottom:15}}>
              {ocrLoading ? "Okunuyor..." : "📸 Fiş Oku"}
            </button>
            <input ref={fileRef} type="file" hidden accept="image/*" onChange={handleReceiptUpload}/>
            <input type="number" placeholder="Tutar" value={form.amount} onChange={e=>setForm({...form, amount:e.target.value})} style={{width:"100%",padding:12,marginBottom:10,background:"#2C2C2E",border:"none",color:"#fff",borderRadius:10}}/>
            <input type="text" placeholder="Açıklama" value={form.desc} onChange={e=>setForm({...form, desc:e.target.value})} style={{width:"100%",padding:12,marginBottom:10,background:"#2C2C2E",border:"none",color:"#fff",borderRadius:10}}/>
            <select value={form.category} onChange={e=>setForm({...form, category:e.target.value})} style={{width:"100%",padding:12,marginBottom:20,background:"#2C2C2E",border:"none",color:"#fff",borderRadius:10}}>
              {CATEGORIES[form.type].map(c=><option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
            </select>
            <button onClick={handleAdd} style={{width:"100%",padding:15,background:form.type==="gelir"?"#34C759":"#FF453A",border:"none",borderRadius:12,color:"#fff",fontWeight:700}}>Ekle</button>
            <button onClick={()=>setShowModal(false)} style={{width:"100%",padding:10,marginTop:10,background:"none",border:"none",color:"#8E8E93"}}>Vazgeç</button>
          </div>
        </div>
      )}

      {/* Reset/Delete Modals (Orijinal yapı korundu) */}
      {deleteId && <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{background:"#1C1C1E",padding:20,borderRadius:20}}>Emin misin? <br/><br/><button onClick={()=>handleDelete(deleteId)}>Evet</button> <button onClick={()=>setDeleteId(null)}>Hayır</button></div></div>}
      {resetStep > 0 && <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{background:"#1C1C1E",padding:20,borderRadius:20}}>Tüm veriler silinecek! <br/><br/><button onClick={handleReset}>Sil</button> <button onClick={()=>setResetStep(0)}>İptal</button></div></div>}

      {/* Uber Result Modal */}
      {showUberModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.9)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#1C1C1E",padding:25,borderRadius:20,width:"80%"}}>
            {uberLoading ? "Analiz ediliyor..." : (
              <div>
                <h3>Uber Özeti</h3>
                <p>Gelir: {fmt(uberResult?.earnings)}</p>
                <p>Gider: {fmt(uberResult?.expenses)}</p>
                <button onClick={()=>confirmUberImport(uberResult)} style={{width:"100%",padding:12,background:"#34C759",border:"none",borderRadius:10}}>İçe Aktar</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
