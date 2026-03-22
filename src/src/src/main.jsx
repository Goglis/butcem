import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

**4.** Sayfanın en altında **"Commit new file"** butonuna bas

---

Şöyle görünmeli:
```
📁 butcem/
├── 📄 package.json       ✅
├── 📄 vite.config.js     ✅  
├── 📄 index.html         ✅
└── 📁 src/
    ├── 📄 main.jsx       ← şu an bunu yapıyorsun
    └── 📄 App.jsx        ← sonra bunu yapacaksın
