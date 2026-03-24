{/* Tutar Girişi */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 13, color: "#8E8E93", marginBottom: 8 }}>Tutar (CAD)</label>
              <input 
                type="text" 
                value={form.amount} 
                onChange={e => setForm({...form, amount: e.target.value})}
                placeholder="0.00"
                style={{ width: "100%", background: "#2C2C2E", border: "1px solid #3A3A3C", borderRadius: 12, padding: "16px", color: "#fff", fontSize: 24, fontWeight: 700 }}
              />
            </div>

            {/* Kategori Seçimi */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 13, color: "#8E8E93", marginBottom: 8 }}>Kategori</label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                {CATEGORIES[form.type].map(cat => (
                  <button 
                    key={cat.id}
                    onClick={() => setForm({...form, category: cat.id})}
                    style={{ 
                      background: form.category === cat.id ? cat.color : "#2C2C2E", 
                      border: "none", borderRadius: 12, padding: "12px 4px", color: "#fff", cursor: "pointer",
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 4, transition: "0.2s"
                    }}
                  >
                    <span style={{ fontSize: 20 }}>{cat.icon}</span>
                    <span style={{ fontSize: 10, fontWeight: 600 }}>{cat.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Açıklama ve Tarih */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24 }}>
              <input 
                type="text" 
                placeholder="Açıklama..." 
                value={form.desc} 
                onChange={e => setForm({...form, desc: e.target.value})}
                style={{ background: "#2C2C2E", border: "none", borderRadius: 12, padding: "12px", color: "#fff" }}
              />
              <input 
                type="date" 
                value={form.date} 
                onChange={e => setForm({...form, date: e.target.value})}
                style={{ background: "#2C2C2E", border: "none", borderRadius: 12, padding: "12px", color: "#fff" }}
              />
            </div>

            {/* Fiş Yükleme Butonu */}
            {form.type === "gider" && (
              <div style={{ marginBottom: 20 }}>
                <input ref={fileRef} type="file" accept="image/*" onChange={handleReceiptUpload} style={{ display: "none" }} />
                <button 
                  onClick={() => fileRef.current.click()}
                  style={{ width: "100%", background: "#0A84FF20", border: "1px dashed #0A84FF", borderRadius: 12, padding: "12px", color: "#0A84FF", fontWeight: 600 }}
                >
                  {ocrLoading ? "Okunuyor... ⏳" : "📸 Fiş Tara (AI)"}
                </button>
              </div>
            )}

            <button 
              onClick={handleAdd}
              style={{ width: "100%", background: form.type === "gelir" ? "#34C759" : "#FF453A", border: "none", borderRadius: 16, padding: "18px", color: "#fff", fontSize: 18, fontWeight: 700 }}
            >
              Ekle
            </button>
          </div>
        </div>
      )}

      {/* Uber Onay Modalı */}
      {showUberModal && uberResult && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "#1C1C1E", borderRadius: 24, padding: 24, width: "100%", border: "1px solid #E65100" }}>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 20, color: "#E65100" }}>🚗 Uber Özeti</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
               <div style={{ display: "flex", justifyContent: "space-between" }}><span>Brüt Kazanç:</span><span style={{ color: "#34C759", fontWeight: 700 }}>{fmt(uberResult.earnings)}</span></div>
               <div style={{ display: "flex", justifyContent: "space-between" }}><span>Kesintiler:</span><span style={{ color: "#FF453A", fontWeight: 700 }}>{fmt(uberResult.expenses)}</span></div>
               <div style={{ borderTop: "1px solid #2C2C2E", paddingTop: 8, display: "flex", justifyContent: "space-between" }}><span>Net Ödeme:</span><span style={{ fontSize: 18, fontWeight: 800 }}>{fmt(uberResult.total)}</span></div>
            </div>
            <button onClick={() => confirmUberImport(uberResult)} style={{ width: "100%", background: "#E65100", border: "none", borderRadius: 12, padding: 16, color: "#fff", fontWeight: 700, marginBottom: 10 }}>Verileri İçe Aktar</button>
            <button onClick={() => setShowUberModal(false)} style={{ width: "100%", background: "transparent", border: "none", color: "#8E8E93" }}>İptal</button>
          </div>
        </div>
      )}
    </div>
  );
}
