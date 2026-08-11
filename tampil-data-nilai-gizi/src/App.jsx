import { useState, useEffect, useCallback } from 'react'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api/nilai-gizi'
const STORAGE_KEY = 'sppg-menu-current'

const CATS = [
  { key: 'k1',     label: 'Porsi Kecil',  sub: 'TK/PAUD & SD 1–3' },
  { key: 'k2',     label: 'Porsi Besar',  sub: 'SD 4–6, SMP & SMA' },
  { key: 'balita', label: 'Balita',       sub: 'Anak Balita' },
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

function defaultState() {
  return {
    date: todayIso(),
    title: 'Menu Sekolah & B3',
    image: '',
    images: [],
    menuItems: [
      'Nasi putih',
      'Egg rol katsu dan saus bangkok',
      'Kacang tanah goreng',
      'Tumis wortel, kacang panjang dan jagung',
      'Buah anggur',
    ],
    nutrition: {
      k1:     { energi: '450', protein: '15', lemak: '12', karbo: '65', serat: '4' },
      k2:     { energi: '650', protein: '22', lemak: '18', karbo: '90', serat: '6' },
      balita: { energi: '350', protein: '12', lemak: '10', karbo: '50', serat: '3' },
      bumil:  { energi: '750', protein: '28', lemak: '22', karbo: '105', serat: '8' },
    },
  }
}

function getPhotoList(state) {
  if (Array.isArray(state?.images) && state.images.length > 0) return state.images
  if (state?.image) return [state.image]
  return []
}

export default function App() {
  const [data, setData]             = useState(null)
  const [activeTab, setActiveTab]   = useState('k1')
  const [loading, setLoading]       = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [photoIndex, setPhotoIndex] = useState(0)

  const fetchData = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true)
    try {
      // 1. Try API /api/nilai-gizi
      const res = await fetch(API_URL)
      if (res.ok) {
        const json = await res.json()
        if (json.success && json.data) {
          const parsed = typeof json.data === 'string' ? JSON.parse(json.data) : json.data
          setData(parsed)
          setLastUpdated(new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
          setLoading(false)
          setRefreshing(false)
          return
        }
      }
    } catch {
      // API call failed, try localStorage fallback
    }

    try {
      // 2. Try generic storage endpoint
      const res2 = await fetch(`http://localhost:5000/api/storage?key=${STORAGE_KEY}`)
      if (res2.ok) {
        const json2 = await res2.json()
        if (json2.value) {
          const parsed2 = typeof json2.value === 'string' ? JSON.parse(json2.value) : json2.value
          setData(parsed2)
          setLastUpdated(new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
          setLoading(false)
          setRefreshing(false)
          return
        }
      }
    } catch {
      // Fallback
    }

    try {
      const local = localStorage.getItem(STORAGE_KEY)
      if (local) {
        setData(JSON.parse(local))
      } else {
        setData(defaultState())
      }
    } catch {
      setData(defaultState())
    }

    setLastUpdated(new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }))
    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => {
    fetchData()

    // Interval fetch every 15 seconds for real-time synchronization
    const interval = setInterval(() => {
      fetchData()
    }, 15000)

    return () => clearInterval(interval)
  }, [fetchData])

  const photos = getPhotoList(data)

  useEffect(() => {
    if (photos.length < 2) return
    const timer = setInterval(() => {
      setPhotoIndex(prev => (prev + 1) % photos.length)
    }, 5000)
    return () => clearInterval(timer)
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

  const currentCat = CATS.find(c => c.key === activeTab)
  const currentNutrition = data.nutrition?.[activeTab] || {}
  const displayIndex = photos.length > 0 ? photoIndex % photos.length : 0

  return (
    <div className="public-wrap">
      {/* BRAND TOPBAR */}
      <header className="public-topbar">
        <div className="brand">
          <img className="brand-logo" src="/icon.png" alt="SPPG BINAWIDYA Logo" />
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
        <div className="hero-kicker">Today's Menu</div>
        <h1>{data.title || 'Menu Sekolah & B3'}</h1>
        <div className="date-badge">
          📅 {fmtDate(data.date)}
        </div>
      </div>

      {/* PHOTO SLIDESHOW / GALLERY */}
      <div className="photo-card">
        {photos.length > 0 ? (
          <div className="slideshow">
            <img src={photos[displayIndex]} alt={`Foto Menu ${displayIndex + 1}`} />
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

      {/* MENU ITEMS SECTION */}
      <div className="section-header">
        <div className="section-label">🍱 MENU HARI INI</div>
        <div className="section-line"></div>
      </div>
      <div className="menu-list">
        {(data.menuItems || []).map((item, idx) => (
          <div className="menu-item" key={idx}>
            <div className="menu-icon">{idx + 1}</div>
            <div>{item}</div>
          </div>
        ))}
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
        <p><b>SPPG BINAWIDYA SIMPANG BARU 7</b></p>
        <p>Sistem Informasi Nilai Gizi Harian &amp; Konsumsi Sekolah</p>
      </footer>
    </div>
  )
}
