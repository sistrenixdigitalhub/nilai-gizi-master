import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Security Warning & Anti-Injection Protection
if (typeof window !== 'undefined') {
  const titleStyle = 'color: #ff3333; font-size: 20px; font-weight: 800; text-shadow: 1px 1px #000;'
  const descStyle = 'font-size: 13px; color: #182a52; font-weight: 600;'
  const credStyle = 'font-size: 12px; color: #666; font-style: italic;'

  console.log('%c⚠️ PERINGATAN KEAMANAN PANEL ADMINISTRATOR', titleStyle)
  console.log('%cArea ini hanya untuk Administrator berwenang SPPG Binawidya. Dilarang menempelkan skrip atau mengeksekusi kode berbahaya (Anti Self-XSS / Injection).', descStyle)
  console.log('%c© 2026 Afnand Fachzevi — Seluruh Hak Cipta Dilindungi.', credStyle)

  // Anti-Frame Hijacking Fallback
  if (window.top !== window.self) {
    try {
      window.top.location = window.self.location
    } catch {
      // Handled by CSP / cross-origin
    }
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

