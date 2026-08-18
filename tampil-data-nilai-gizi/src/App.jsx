import { useState, useEffect, useCallback, useRef } from 'react'
import { db } from './firebase'
import { doc, onSnapshot, getDoc } from 'firebase/firestore'
import './App.css'

const STORAGE_ENDPOINT = 'https://binawidya-simpang-baru-7-nilai-gizi.vercel.app/api/storage'
const GITHUB_RAW_URL   = 'https://raw.githubusercontent.com/sistrenixdigitalhub/nilai-gizi-master/main/data/menu.json'

const DATA_TTL_MS = 24 * 60 * 60 * 1000 // 24 jam

const CATS = [
  { key: 'k1',     label: 'Porsi Kecil',   sub: 'TK/PAUD & SD 1–3' },
  { key: 'k2',     label: 'Porsi Besar',   sub: 'SD 4–6, SMP & SMA' },
  { key: 'balita', label: 'Balita',        sub: 'Anak Balita' },
  { key: 'bumil',  label: 'Bumil & Busui', sub: 'Ibu Hamil & Menyusui' },
]

const FIELDS = [
  { key: 'energi',  label: 'Energi',      unit: 'kkal' },
  { key: 'protein', label: 'Protein',     unit: 'gr' },
  { key: 'lemak',   label: 'Lemak',       unit: 'gr' },
  { key: 'karbo',   label: 'Karbohidrat', unit: 'gr' },
  { key: 'serat',   label: 'Serat',       unit: 'gr' },
]

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    })
  } catch {
    return iso
  }
}

// Returns true if menu data is expired:
// - date is not today (catches old data without savedAt), OR
// - savedAt exists and is older than 24h
function isDataExpired(menu) {
  if (!menu) return false
  if (menu.date && menu.date !== todayIso()) return true
  if (menu.savedAt && Date.now() - new Date(menu.savedAt).getTime() > DATA_TTL_MS) return true
  return false
}

// ── SECURITY & SANITIZATION HELPERS ──
function isSafeImageUrl(url) {
  if (!url || typeof url !== 'string') return false
  const trimmed = url.trim()
  // Allow safe base64 data URLs for images
  if (/^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,/i.test(trimmed)) return true
  // Allow secure https URLs
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://localhost:')) return true
  // Allow root-relative static asset paths (e.g. /icon.png)
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true
  return false
}

function sanitizeText(str) {
  if (str === null || str === undefined) return ''
  // Strip HTML angle brackets and dangerous characters to prevent injection
  return String(str)
    .replace(/[<>]/g, '')
    .trim()
}

function sanitizeMenuData(d) {
  if (!d || typeof d !== 'object') return null
  const rawList = Array.isArray(d.images) ? d.images : (d.image ? [d.image] : [])
  const sanitizedImages = rawList.filter(isSafeImageUrl)

  const sanitizedMenuItems = Array.isArray(d.menuItems)
    ? d.menuItems.map(sanitizeText).filter(Boolean)
    : []

  const sanitizedNutrition = { k1: {}, k2: {}, balita: {}, bumil: {} }
  if (d.nutrition && typeof d.nutrition === 'object') {
    for (const cat of ['k1', 'k2', 'balita', 'bumil']) {
      sanitizedNutrition[cat] = {}
      if (d.nutrition[cat] && typeof d.nutrition[cat] === 'object') {
        for (const field of ['energi', 'protein', 'lemak', 'karbo', 'serat']) {
          sanitizedNutrition[cat][field] = sanitizeText(d.nutrition[cat][field])
        }
      }
    }
  }

  return {
    date: sanitizeText(d.date) || todayIso(),
    title: sanitizeText(d.title),
    image: sanitizedImages[0] || '',
    images: sanitizedImages,
    menuItems: sanitizedMenuItems,
    nutrition: sanitizedNutrition,
    savedAt: d.savedAt || null,
  }
}

// Add cache-busting to GitHub raw URLs to avoid stale CDN images
function bustCache(url) {
  if (!url || url.startsWith('data:')) return url
  const cleanUrl = url.split('?')[0]
  return `${cleanUrl}?t=${Date.now()}`
}

function getPhotoList(state) {
  if (Array.isArray(state?.images) && state.images.length > 0) return state.images.map(bustCache)
  if (state?.image) return [bustCache(state.image)]
  return []
}

// Get raw URLs without cache-busting (for comparison only)
function getRawPhotoList(state) {
  if (Array.isArray(state?.images) && state.images.length > 0) return state.images
  if (state?.image) return [state.image]
  return []
}

export default function App() {
  const [data,         setData]         = useState(null)
  const [activeTab,    setActiveTab]    = useState('k1')
  const [loading,      setLoading]      = useState(true)
  const [refreshing,   setRefreshing]   = useState(false)
  const [lastUpdated,  setLastUpdated]  = useState(null)
  const [photoIndex,   setPhotoIndex]   = useState(0)
  const [lightbox,     setLightbox]     = useState(null) // null = closed, number = open index
  const lightboxRef = useRef(null)
  const prevDataRef = useRef(null)

  const applyData = useCallback((raw) => {
    const d = sanitizeMenuData(raw)
    // Only reset photoIndex when images actually change (compare raw URLs)
    const prevPhotos = JSON.stringify(getRawPhotoList(prevDataRef.current))
    const newPhotos  = JSON.stringify(getRawPhotoList(d))
    if (prevPhotos !== newPhotos) {
      setPhotoIndex(0)
    }
    prevDataRef.current = d
    setData(d)
    setLastUpdated(new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    setLoading(false)
    setRefreshing(false)
  }, [])

  const fetchData = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true)

    // 1. PRIMARY: Firebase Firestore (Real-time & Fast)
    try {
      const docRef = doc(db, 'sppg', 'menu-current')
      const docSnap = await getDoc(docRef)
      if (docSnap.exists()) {
        const d = docSnap.data()
        if (d && (d.title || d.menuItems?.length > 0 || d.images?.length > 0 || d.image)) {
          applyData(d)
          return
        }
      }
    } catch (err) {
      console.warn('Firestore fetch fallback:', err)
    }

    // 2. FALLBACK A: Vercel API (reads from GitHub API)
    try {
      const res = await fetch(`${STORAGE_ENDPOINT}?_=${Date.now()}`, { cache: 'no-store' })
      if (res.ok) {
        const json = await res.json()
        if (json.value) {
          const d = typeof json.value === 'string' ? JSON.parse(json.value) : json.value
          if (d && (d.title || d.menuItems?.length > 0 || d.images?.length > 0 || d.image)) {
            applyData(d)
            return
          }
        }
      }
    } catch (err) {
      void err
    }

    // 3. FALLBACK B: GitHub raw URL
    try {
      const res = await fetch(GITHUB_RAW_URL + '?_=' + Date.now(), { cache: 'no-store' })
      if (res.ok) {
        const d = await res.json()
        if (d && (d.title || d.menuItems?.length > 0 || d.images?.length > 0 || d.image)) {
          applyData(d)
          return
        }
      }
    } catch (err) {
      void err
    }

    // No data — show empty state
    applyData({ date: todayIso(), title: '', image: '', images: [], menuItems: [], nutrition: { k1:{}, k2:{}, balita:{}, bumil:{} }, savedAt: null })
  }, [applyData])

  useEffect(() => {
    let active = true

    // Real-time Firestore Listener
    let unsubscribe = null
    try {
      const docRef = doc(db, 'sppg', 'menu-current')
      unsubscribe = onSnapshot(docRef, (docSnap) => {
        if (!active) return
        if (docSnap.exists()) {
          const d = docSnap.data()
          if (d && (d.title || d.menuItems?.length > 0 || d.images?.length > 0 || d.image)) {
            applyData(d)
            return
          }
        }
        void fetchData(false)
      }, (error) => {
        console.warn('Firestore snapshot error, falling back to polling:', error)
        void fetchData(false)
      })
    } catch (e) {
      console.warn('Firestore snapshot init error:', e)
      void fetchData(false)
    }

    // Secondary Polling interval (every 30 seconds for fallback redundancy)
    const interval = setInterval(() => {
      if (active) void fetchData(false)
    }, 30000)

    return () => {
      active = false
      if (unsubscribe) unsubscribe()
      clearInterval(interval)
    }
  }, [fetchData, applyData])


  // Whether the current data is expired (older than 24h)
  const expired = isDataExpired(data)

  // Photos: show empty if data is expired
  const photos = (expired || !data) ? [] : getPhotoList(data)

  // Auto-advance slideshow
  useEffect(() => {
    if (photos.length < 2) return
    const timer = setInterval(() => {
      setPhotoIndex(prev => (prev + 1) % photos.length)
    }, 5000)
    return () => clearInterval(timer)
  }, [photos.length])

  // Keyboard navigation for lightbox
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') setLightbox(null)
      if (e.key === 'ArrowRight') setLightbox(prev => prev !== null ? (prev + 1) % photos.length : null)
      if (e.key === 'ArrowLeft')  setLightbox(prev => prev !== null ? (prev - 1 + photos.length) % photos.length : null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [photos.length])

  if (loading || !data) {
    return (
      <div className="public-wrap" style={{ textAlign: 'center', paddingTop: '80px' }}>
        <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--navy)' }}>
          Memuat Data Nilai Gizi...
        </div>
      </div>
    )
  }

  // If data is expired — show empty/no-menu state
  if (expired) {
    return (
      <div className="public-wrap">
        <header className="public-topbar">
          <div className="brand">
            <img className="brand-logo" src="/icon.png" alt="SPPG BINAWIDYA Logo" draggable="false" onContextMenu={(e) => e.preventDefault()} />
            <div className="brand-names">
              <b>SPPG BINAWIDYA</b>
              <span>SIMPANG BARU 7</span>
            </div>
          </div>
          <div className="public-badge">
            <span className="public-badge-dot" style={{ background: '#aaa', boxShadow: 'none' }}></span>
            TAMPILAN PUBLIK
          </div>
        </header>

        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🍽️</div>
          <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--navy)', marginBottom: '8px' }}>
            Menu Belum Tersedia
          </div>
          <div style={{ fontSize: '14px', color: 'var(--navy-2)', maxWidth: '300px', margin: '0 auto', lineHeight: 1.6 }}>
            Menu hari ini belum diinput atau sudah melewati 24 jam. Silakan cek kembali nanti.
          </div>
          <div style={{ marginTop: '16px', fontSize: '12px', color: '#999' }}>
            Terakhir diperbarui: {lastUpdated || '—'}
          </div>
          <button
            style={{ marginTop: '16px', background: 'none', border: 'none', color: 'var(--navy-2)', cursor: 'pointer', fontSize: '13px', textDecoration: 'underline' }}
            onClick={() => fetchData(true)}
          >
            {refreshing ? 'Memuat...' : 'Coba perbarui'}
          </button>
        </div>

        <footer className="public-footer">
          <div className="security-badge-seal">
            <span className="shield-icon">🛡️</span> Sistem Terverifikasi &amp; Terlindungi
          </div>
          <p className="footer-title"><b>SPPG BINAWIDYA SIMPANG BARU 7</b></p>
          <p className="footer-subtitle">Sistem Informasi Nilai Gizi Harian &amp; Konsumsi Sekolah</p>
          <div className="copyright-box">
            <p className="copyright-text">&copy; 2026 <strong>Afnand Fachzevi</strong> &bull; Seluruh Hak Cipta Dilindungi</p>
            <div className="creator-badge">
              <span className="creator-star">★</span> Karya Resmi <strong>Afnand Fachzevi</strong> sebagai Pembuat
            </div>
          </div>
        </footer>
      </div>
    )
  }

  const currentCat       = CATS.find(c => c.key === activeTab)
  const currentNutrition = data.nutrition?.[activeTab] || {}
  const displayIndex     = photos.length > 0 ? photoIndex % photos.length : 0

  return (
    <div className="public-wrap">
      {/* BRAND TOPBAR */}
      <header className="public-topbar">
        <div className="brand">
          <img className="brand-logo" src="/icon.png" alt="SPPG BINAWIDYA Logo" draggable="false" onContextMenu={(e) => e.preventDefault()} />
          <div className="brand-names">
            <b>SPPG BINAWIDYA</b>
            <span>SIMPANG BARU 7</span>
          </div>
        </div>
        <div className="public-badge">
          <span className="public-badge-dot"></span>
          TAMPILAN PUBLIK
        </div>
      </header>

      {/* REFRESH BAR */}
      <div className="refresh-bar">
        <span>
          Terakhir diperbarui: <strong>{lastUpdated || 'Baru saja'}</strong>
        </span>
        <button
          className={`refresh-btn${refreshing ? ' spinning' : ''}`}
          onClick={() => fetchData(true)}
          disabled={refreshing}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
          </svg>
          {refreshing ? 'Memuat...' : 'Perbarui'}
        </button>
      </div>

      {/* HERO SECTION */}
      <div className="hero">
        <div className="hero-kicker">Today&apos;s Menu</div>
        <h1>{data.title || 'Belum Ada Judul Menu'}</h1>
        <div className="date-badge">
          📅 {fmtDate(data.date)}
        </div>
      </div>

      {/* PHOTO SLIDESHOW / GALLERY */}
      <div className="photo-card">
        {photos.length > 0 ? (
          <div className="slideshow">
            <img
              src={photos[displayIndex]}
              alt={`Foto Menu ${displayIndex + 1}`}
              onClick={() => setLightbox(displayIndex)}
              style={{ cursor: 'zoom-in' }}
              title="Klik untuk perbesar"
              draggable="false"
              onContextMenu={(e) => e.preventDefault()}
            />
            <div className="photo-zoom-hint">🔍 Klik foto untuk perbesar</div>
            {photos.length > 1 && (
              <div className="slideshow-controls">
                <button
                  className="slideshow-btn"
                  onClick={() => setPhotoIndex(prev => (prev - 1 + photos.length) % photos.length)}
                  aria-label="Foto sebelumnya"
                >
                  ‹
                </button>
                <div className="slideshow-dots">
                  {photos.map((_, idx) => (
                    <span
                      key={idx}
                      className={`slideshow-dot${idx === photoIndex ? ' active' : ''}`}
                    />
                  ))}
                </div>
                <button
                  className="slideshow-btn"
                  onClick={() => setPhotoIndex(prev => (prev + 1) % photos.length)}
                  aria-label="Foto berikutnya"
                >
                  ›
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="photo-empty">
            Belum ada foto menu untuk hari ini
          </div>
        )}
      </div>

      {/* LIGHTBOX POPUP */}
      {lightbox !== null && photos.length > 0 && (
        <div
          className="lightbox-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setLightbox(null) }}
          ref={lightboxRef}
        >
          <button className="lightbox-close" onClick={() => setLightbox(null)} aria-label="Tutup">
            ✕
          </button>
          <button
            className="lightbox-nav lightbox-prev"
            onClick={() => setLightbox(prev => (prev - 1 + photos.length) % photos.length)}
            aria-label="Foto sebelumnya"
          >‹</button>
          <div className="lightbox-img-wrap">
            <img
              src={photos[lightbox]}
              alt={`Foto Menu ${lightbox + 1}`}
              className="lightbox-img"
              draggable="false"
              onContextMenu={(e) => e.preventDefault()}
            />
            <div className="lightbox-counter">{lightbox + 1} / {photos.length}</div>
          </div>
          <button
            className="lightbox-nav lightbox-next"
            onClick={() => setLightbox(prev => (prev + 1) % photos.length)}
            aria-label="Foto berikutnya"
          >›</button>
        </div>
      )}

      {/* MENU ITEMS SECTION */}
      <div className="section-header">
        <div className="section-label">🍱 MENU HARI INI</div>
        <div className="section-line"></div>
      </div>
      <div className="menu-list">
        {(data.menuItems || []).length > 0 ? (
          (data.menuItems || []).map((item, idx) => (
            <div className="menu-item" key={idx}>
              <div className="menu-icon">{idx + 1}</div>
              <div>{item}</div>
            </div>
          ))
        ) : (
          <div className="menu-item" style={{ justifyContent: 'center', color: 'var(--navy-2)', fontStyle: 'italic', fontWeight: 600 }}>
            Belum ada menu yang diinput untuk hari ini
          </div>
        )}
      </div>

      {/* NUTRITION SECTION */}
      <div className="section-header">
        <div className="section-label">📊 KANDUNGAN GIZI</div>
        <div className="section-line"></div>
      </div>

      <div className="nutri-tabs-wrap">
        <div className="tabs">
          {CATS.map(cat => (
            <div
              key={cat.key}
              className={`tab${cat.key === activeTab ? ' active' : ''}`}
              onClick={() => setActiveTab(cat.key)}
            >
              {cat.label}
            </div>
          ))}
        </div>

        <div className="nutri-container">
          <div className="cat-header">
            <div>
              <div className="cat-tag">{currentCat.label.toUpperCase()}</div>
              <div className="cat-sub">{currentCat.sub}</div>
            </div>
          </div>

          <div className="nutri-grid">
            {FIELDS.map(f => (
              <div className="nutri-card-item" key={f.key}>
                <div className="nutri-item-label">{f.label}</div>
                <div className="nutri-item-value">
                  {currentNutrition[f.key] || '0'}
                  <span className="nutri-item-unit">{f.unit}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <footer className="public-footer">
        <div className="security-badge-seal">
          <span className="shield-icon">🛡️</span> Sistem Terverifikasi &amp; Terlindungi
        </div>
        <p className="footer-title"><b>SPPG BINAWIDYA SIMPANG BARU 7</b></p>
        <p className="footer-subtitle">Sistem Informasi Nilai Gizi Harian &amp; Konsumsi Sekolah</p>
        <div className="copyright-box">
          <p className="copyright-text">&copy; 2026 <strong>Afnand Fachzevi</strong> &bull; Seluruh Hak Cipta Dilindungi</p>
          <div className="creator-badge">
            <span className="creator-star">★</span> Karya Resmi <strong>Afnand Fachzevi</strong> sebagai Pembuat
          </div>
        </div>
      </footer>
    </div>
  )
}

