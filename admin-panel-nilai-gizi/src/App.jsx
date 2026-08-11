import { useState, useEffect, useRef, useCallback } from 'react'
import QRCode from 'qrcode'
import './App.css'

// ── CONSTANTS ──
const STORAGE_KEY = 'sppg-menu-current'
const PIN_KEY     = 'sppg-admin-pin'
const USER_KEY    = 'sppg-admin-username'
const DEFAULT_ADMIN_USERNAME = 'adis'
const DEFAULT_ADMIN_PASSWORD = '2819'
const BUILTIN_ACCOUNTS = [
  { username: 'adis',       password: '2819' },
  { username: 'superadmin', password: '20899' },
]
const SESSION_TTL = 2 * 60 * 60 * 1000 // 2 jam

const CATS = [
  { key: 'k1',     label: 'Porsi Kecil (TK/PAUD & SD 1–3)' },
  { key: 'k2',     label: 'Porsi Besar (SD 4–6, SMP & SMA)' },
  { key: 'balita', label: 'Balita' },
  { key: 'bumil',  label: 'Bumil & Busui' },
]
const FIELDS = [
  { key: 'energi',  label: 'Energi (kkal)' },
  { key: 'protein', label: 'Protein (gr)' },
  { key: 'lemak',   label: 'Lemak (gr)' },
  { key: 'karbo',   label: 'Karbohidrat (gr)' },
  { key: 'serat',   label: 'Serat (gr)' },
]

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function getCookie(name) {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'))
  return match ? decodeURIComponent(match[2]) : null
}

function setCookie(name, value, days = 365) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`
}

function defaultState() {
  return {
    date: todayIso(),
    title: '',
    image: '',
    images: [],
    menuItems: [],
    nutrition: {
      k1:     { energi:'', protein:'', lemak:'', karbo:'', serat:'' },
      k2:     { energi:'', protein:'', lemak:'', karbo:'', serat:'' },
      balita: { energi:'', protein:'', lemak:'', karbo:'', serat:'' },
      bumil:  { energi:'', protein:'', lemak:'', karbo:'', serat:'' },
    },
  }
}

// ── STORAGE HELPERS ──
const STORAGE_API = import.meta.env.VITE_API_URL || 'https://binawidya-simpang-baru-7-nilai-gizi.vercel.app/api/storage'

async function storageGet(key) {
  try {
    const res = await fetch(`${STORAGE_API}?key=${encodeURIComponent(key)}`)
    if (res.ok) {
      const json = await res.json()
      return json.value !== undefined && json.value !== null ? { value: json.value } : null
    }
  } catch {
    // ignore remote failure, fallback to localStorage
  }

  try {
    const raw = localStorage.getItem(key)
    return raw ? { value: raw } : null
  } catch {
    return null
  }
}

async function storageSet(key, value) {
  try {
    const res = await fetch(STORAGE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    })
    if (res.ok) {
      const json = await res.json().catch(() => ({}))
      return { ok: true, persistent: json.persistent !== false }
    }
  } catch {
    // ignore remote failure, fallback to localStorage
  }

  try {
    localStorage.setItem(key, value)
    return { ok: true, persistent: false }
  } catch {
    return null
  }
}

async function getAdminCredentials() {
  const userRes = await storageGet(USER_KEY)
  const passRes = await storageGet(PIN_KEY)
  return {
    username: userRes?.value || DEFAULT_ADMIN_USERNAME,
    password: passRes?.value || DEFAULT_ADMIN_PASSWORD,
  }
}

async function verifyAdminCredentials(inputUser, inputPass) {
  const u = (inputUser || '').trim()
  const p = (inputPass || '').trim()

  const matchBuiltin = BUILTIN_ACCOUNTS.find(acc => acc.username === u && acc.password === p)
  if (matchBuiltin) return true

  const userRes = await storageGet(USER_KEY)
  const passRes = await storageGet(PIN_KEY)
  const storedUser = userRes?.value || DEFAULT_ADMIN_USERNAME
  const storedPass = passRes?.value || DEFAULT_ADMIN_PASSWORD

  if (u === storedUser && p === storedPass) return true

  return false
}

// ── SESSION ──
function checkSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem('sppg-session') || 'null')
    return s && Date.now() - s.ts < SESSION_TTL
  } catch { return false }
}
function setSession()   { sessionStorage.setItem('sppg-session', JSON.stringify({ ts: Date.now() })) }
function clearSession() { sessionStorage.removeItem('sppg-session') }

// ── UTILS ──
function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso + 'T00:00:00').toLocaleDateString('id-ID', { day:'numeric', month:'long', year:'numeric' })
}

function getPhotoList(state) {
  if (Array.isArray(state?.images) && state.images.length > 0) return state.images
  if (state?.image) return [state.image]
  return []
}

function resizeImage(file, maxWidth = 800) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        const scale  = Math.min(1, maxWidth / img.width)
        const canvas = document.createElement('canvas')
        canvas.width  = Math.round(img.width  * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.72))
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  })
}

// ── TOAST ──
function Toast({ message }) {
  return <div className={`toast${message ? ' show' : ''}`}>{message}</div>
}

// ── QR CODE SECTION FOR PUBLIC DISPLAY ──
function QRCodeSection({ showToast }) {
  const PUBLIC_URL = 'https://sppg-binawidya-simpang-baru-7-nilai.vercel.app/'
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!canvasRef.current) return
    QRCode.toCanvas(canvasRef.current, PUBLIC_URL, {
      width: 140,
      margin: 2,
      color: {
        dark: '#182A52',
        light: '#FFFFFF'
      }
    }, (err) => {
      if (err) console.error('QR code error:', err)
    })
  }, [PUBLIC_URL])

  const copyLink = () => {
    navigator.clipboard.writeText(PUBLIC_URL).then(() => showToast('Link berhasil disalin! ✓'))
  }

  const downloadQr = () => {
    if (!canvasRef.current) return
    const dataUrl = canvasRef.current.toDataURL('image/png')
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = 'sppg-public-qr.png'
    document.body.appendChild(link)
    link.click()
    link.remove()
    showToast('QR Code berhasil diunduh! ✓')
  }

  return (
    <div className="qr-card">
      <div className="qr-preview-box">
        <canvas ref={canvasRef} />
      </div>
      <div className="qr-text">
        <b>📱 QR Code Tampilan Publik</b>
        <span>Scan QR Code ini untuk membuka halaman Nilai Gizi.</span>
        
        <div style={{ marginTop: '10px', marginBottom: '10px' }}>
          <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--navy)', display: 'block', marginBottom: '4px' }}>Link Nilai Gizi:</label>
          <span className="qr-url">{PUBLIC_URL}</span>
        </div>

        <div className="qr-actions">
          <button className="copy-btn" onClick={copyLink}>📋 Salin Link</button>
          <button className="download-btn" onClick={downloadQr}>⬇️ Unduh QR Code</button>
        </div>
      </div>
    </div>
  )
}

// ── TOPBAR ──
function Topbar({ isAdmin, onLogout, onEdit, onResetPassword }) {
  const [showAdminActions, setShowAdminActions] = useState(false)
  const actionsRef = useRef(null)

  useEffect(() => {
    if (!showAdminActions) return
    const handleClick = (event) => {
      if (actionsRef.current && !actionsRef.current.contains(event.target)) {
        setShowAdminActions(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showAdminActions])

  return (
    <header className="topbar">
      <div className="brand">
        <img className="brand-logo" src="/icon.png" alt="SPPG BINAWIDYA logo" />
        <div className="brand-names">
          <b>SPPG BINAWIDYA</b>
          <span>SIMPANG BARU 7 - ADMIN PANEL</span>
        </div>
      </div>
      <div className="header-actions" ref={actionsRef}>
        {isAdmin && (
          <>
            <span className="mode-badge admin">ADMIN</span>
            <button className="edit-btn" onClick={onEdit}>✎ Edit Menu</button>
            <div className="admin-actions-wrap">
              <button className="admin-action-btn" onClick={() => setShowAdminActions(prev => !prev)}>
                ⚙️
              </button>
              {showAdminActions && (
                <div className="admin-action-menu">
                  <button className="admin-action-item" onClick={() => { setShowAdminActions(false); onResetPassword() }}>
                    Ubah Password
                  </button>
                  <button className="admin-action-item logout" onClick={() => { setShowAdminActions(false); onLogout() }}>
                    Keluar
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </header>
  )
}

function LoginScreen({ onSuccess }) {
  const [username, setUsername]               = useState('')
  const [password, setPassword]               = useState('')
  const [rememberSession, setRememberSession] = useState(true)
  const [error, setError]                     = useState('')
  const usernameRef                           = useRef(null)

  useEffect(() => { usernameRef.current?.focus() }, [])

  const tryLogin = useCallback(async () => {
    if (!username.trim() || !password) {
      setError('Harap masukkan username dan password.')
      return
    }
    const isValid = await verifyAdminCredentials(username, password)
    if (isValid) {
      if (rememberSession) {
        setSession()
      } else {
        clearSession()
      }
      onSuccess()
    } else {
      setError('Username atau password salah. Coba lagi.')
      setPassword('')
      setTimeout(() => usernameRef.current?.focus(), 50)
    }
  }, [onSuccess, username, password, rememberSession])

  return (
    <div className="login-screen">
      <div className="login-card">
        <img className="login-logo" src="/icon.png" alt="SPPG BINAWIDYA logo" />
        <h1>Admin Login</h1>
        <p>Silakan masukkan username dan password untuk mengelola data menu SPPG Binawidya.</p>
        <div className="field">
          <label>Username</label>
          <input
            ref={usernameRef}
            type="text"
            value={username}
            placeholder="Masukkan username admin"
            onChange={e => setUsername(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            placeholder="Masukkan password admin"
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && tryLogin()}
          />
        </div>
        <div className="remember-option" style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center', margin: '14px 0 10px', fontSize: '13.5px', color: 'var(--navy)' }}>
          <input
            type="checkbox"
            id="remember"
            checked={rememberSession}
            onChange={e => setRememberSession(e.target.checked)}
            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
          />
          <label htmlFor="remember" style={{ cursor: 'pointer', fontWeight: 600 }}>Simpan sesi login di perangkat ini</label>
        </div>
        {error && <div className="status-msg err">{error}</div>}
        <div className="sheet-actions">
          <button className="btn primary" onClick={tryLogin}>Masuk</button>
        </div>
      </div>
    </div>
  )
}

// ── CHANGE PASSWORD ──
function ChangePasswordSection({ openOnMount = false, hideToggle = false, storageConsent = 'unknown' }) {
  const [open, setOpen]     = useState(openOnMount)
  const [oldP, setOld]      = useState('')
  const [newP, setNew]      = useState('')
  const [conP, setCon]      = useState('')
  const [status, setStatus] = useState({ msg:'', ok:true })

  const doChange = async () => {
    if (storageConsent !== 'yes') {
      setStatus({ msg:'Anda harus menyetujui cookie untuk menyimpan password.', ok:false })
      return
    }
    const { password: currentPassword } = await getAdminCredentials()
    if (oldP !== currentPassword) { setStatus({ msg:'Password lama salah.', ok:false }); return }
    if (!newP.trim()) { setStatus({ msg:'Password baru tidak boleh kosong.', ok:false }); return }
    if (newP !== conP) { setStatus({ msg:'Konfirmasi password tidak cocok.', ok:false }); return }
    const result = await storageSet(PIN_KEY, newP)
    if (result) {
      setStatus({ msg:'Password berhasil diubah ✓', ok:true })
      setOld(''); setNew(''); setCon('')
    } else {
      setStatus({ msg:'Gagal menyimpan. Coba lagi.', ok:false })
    }
  }

  return (
    <div>
      <div className="divider" />
      {!hideToggle && (
        <span className="change-pin-toggle" onClick={() => setOpen(!open)}>
          {open ? '▲' : '▼'} ⚙️ Ubah Password Admin
        </span>
      )}
      {open && (
        <div>
          <div className="field"><label>Password Saat Ini</label><input type="password" value={oldP} onChange={e=>setOld(e.target.value)} /></div>
          <div className="field"><label>Password Baru</label><input type="password" value={newP} onChange={e=>setNew(e.target.value)} /></div>
          <div className="field"><label>Konfirmasi Password Baru</label><input type="password" value={conP} onChange={e=>setCon(e.target.value)} /></div>
          <button className="small-btn" onClick={doChange}>Ganti Password</button>
          {status.msg && <div className={`status-msg ${status.ok?'ok':'err'}`}>{status.msg}</div>}
        </div>
      )}
    </div>
  )
}

function PasswordModal({ onClose }) {
  return (
    <div className="edit-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="edit-sheet">
        <h2>🔒 Ubah Password Admin</h2>
        <p className="sub">Ganti password admin tanpa membuka tampilan Edit Menu.</p>
        <ChangePasswordSection openOnMount hideToggle storageConsent="yes" />
        <div className="sheet-actions">
          <button className="btn ghost" onClick={onClose}>Tutup</button>
        </div>
      </div>
    </div>
  )
}

// ── EDIT MODAL ──
function EditModal({ state, onSave, onClose }) {
  const [date,      setDate]      = useState(state.date)
  const [title,     setTitle]     = useState(state.title)
  const [menuText,  setMenuText]  = useState((state.menuItems||[]).join('\n'))
  const [images,    setImages]    = useState(getPhotoList(state))
  const [nutrition, setNutrition] = useState(JSON.parse(JSON.stringify(state.nutrition)))
  const [status,    setStatus]    = useState({ msg:'', ok:true })
  const fileRef = useRef()

  const handleFile = async (e) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    const dataUrls = await Promise.all(files.map(file => resizeImage(file, 800)))
    setImages(prev => [...prev, ...dataUrls])
    e.target.value = ''
  }

  const removeImage = (idx) => {
    setImages(prev => prev.filter((_, i) => i !== idx))
  }

  const handleNutri = (cat, field, val) => {
    setNutrition(prev => ({ ...prev, [cat]: { ...prev[cat], [field]: val } }))
  }

  const handleSave = async () => {
    const next = {
      date,
      title: title.trim() || 'Menu Sekolah & B3',
      image: images[0] || '',
      images,
      menuItems: menuText.split('\n').map(s => s.trim()).filter(Boolean),
      nutrition,
    }
    const ok = await storageSet(STORAGE_KEY, JSON.stringify(next))
    if (ok) {
      setStatus({ msg:'Tersimpan ✓', ok:true })
      setTimeout(() => { onSave(next); onClose() }, 500)
    } else {
      setStatus({ msg:'Gagal menyimpan. Coba lagi.', ok:false })
    }
  }

  return (
    <div className="edit-overlay" onClick={e => e.target===e.currentTarget && onClose()}>
      <div className="edit-sheet">
        <h2>✎ Edit Menu Hari Ini</h2>
        <p className="sub">Perubahan akan langsung tersimpan ke API & memperbarui tampilan publik.</p>

        <div className="field">
          <label>Tanggal Menu</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label>Judul Menu</label>
          <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Menu Sekolah & B3" />
        </div>
        <div className="field">
          <label>Foto Menu</label>
          <div className="upload-zone" onClick={() => fileRef.current.click()}>
            <div className="hint">Pilih beberapa foto. Minimal 2 foto akan membuat slideshow otomatis.</div>
            {images.length > 0 ? (
              <div className="photo-preview-grid">
                {images.map((src, idx) => (
                  <div className="photo-preview-item" key={`${src}-${idx}`}>
                    <img src={src} alt={`preview-${idx + 1}`} />
                    <button type="button" className="photo-remove-btn" onClick={(e) => { e.stopPropagation(); removeImage(idx) }}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="photo-empty-inline">Belum ada foto</div>
            )}
            <input ref={fileRef} type="file" accept="image/*" multiple style={{ display:'none' }} onChange={handleFile} />
          </div>
        </div>
        <div className="field">
          <label>Daftar Menu (1 baris = 1 item)</label>
          <textarea value={menuText} onChange={e => setMenuText(e.target.value)} placeholder={'Nasi putih\nEgg rol katsu dan saus bangkok\nKacang tanah goreng'} />
        </div>
        <div className="field">
          <label>Kandungan Gizi per Kategori</label>
          {CATS.map(cat => (
            <div className="cat-block" key={cat.key}>
              <div className="cat-title">{cat.label}</div>
              <div className="grid2">
                {FIELDS.map(f => (
                  <div className="field" key={f.key}>
                    <label>{f.label}</label>
                    <input
                      type="text" inputMode="decimal"
                      value={nutrition[cat.key]?.[f.key] || ''}
                      onChange={e => handleNutri(cat.key, f.key, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="sheet-actions">
          <button className="btn ghost" onClick={onClose}>Batal</button>
          <button className="btn primary" onClick={handleSave}>💾 Simpan</button>
        </div>
        {status.msg && <div className={`status-msg ${status.ok?'ok':'err'}`}>{status.msg}</div>}
      </div>
    </div>
  )
}

// ── MAIN APP ──
export default function App() {
  const [menuState,      setMenuState]      = useState(null)
  const [activeTab,      setActiveTab]      = useState('k1')
  const [isAdmin,        setIsAdmin]        = useState(false)
  const [modal,          setModal]          = useState(null) // 'edit' | 'password' | null
  const [storageConsent, setStorageConsent] = useState('unknown') // 'yes' | 'no' | 'unknown'
  const [toast,          setToast]          = useState('')
  const [loading,        setLoading]        = useState(true)
  const [photoIndex,     setPhotoIndex]     = useState(0)

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  // Load data on mount
  useEffect(() => {
    const init = async () => {
      const consent = getCookie('storage_consent') === 'yes'
      const consentState = getCookie('storage_consent')
      setStorageConsent(consentState === 'yes' ? 'yes' : consentState === 'no' ? 'no' : 'unknown')

      const res = await storageGet(STORAGE_KEY)
      const stored = res?.value ? (typeof res.value === 'string' ? JSON.parse(res.value) : res.value) : null
      const data = stored || defaultState()

      if (consent && !stored) {
        await storageSet(STORAGE_KEY, JSON.stringify(data))
      }
      setMenuState(data)

      if (checkSession()) setIsAdmin(true)
      setLoading(false)
    }
    init()
  }, [])

  const handleAcceptStorage = async () => {
    setCookie('storage_consent', 'yes')
    setStorageConsent('yes')
    if (menuState) {
      await storageSet(STORAGE_KEY, JSON.stringify(menuState))
    }
    showToast('Penyimpanan data diaktifkan.')
  }

  const handleDeclineStorage = () => {
    setCookie('storage_consent', 'no')
    setStorageConsent('no')
    showToast('Penyimpanan data dinonaktifkan.')
  }

  const handleLoginSuccess = () => {
    setIsAdmin(true)
    setModal(null)
    showToast('Login berhasil! Selamat datang, Admin.')
  }

  const handleLogout = () => {
    clearSession()
    setIsAdmin(false)
    setModal(null)
    showToast('Berhasil keluar dari mode Admin.')
  }

  const consentBanner = storageConsent === 'unknown' ? (
    <div className="cookie-banner">
      <div>
        Situs ini menggunakan cookie untuk menyimpan data session admin.
      </div>
      <div className="cookie-actions">
        <button className="btn ghost" onClick={handleDeclineStorage}>Tolak</button>
        <button className="btn primary" onClick={handleAcceptStorage}>Setuju</button>
      </div>
    </div>
  ) : null

  const handleSave = async (next) => {
    setMenuState(next)
    await storageSet(STORAGE_KEY, JSON.stringify(next))
    showToast('Menu berhasil disimpan ke API & Publik!')
  }

  const photos = getPhotoList(menuState)

  useEffect(() => {
    if (photos.length < 2) return
    const timer = window.setInterval(() => {
      setPhotoIndex(prev => (prev + 1) % photos.length)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [photos.length])

  if (loading || !menuState) return <div style={{ textAlign:'center', padding:'60px 20px', color:'var(--navy-2)', fontWeight:600 }}>Memuat Panel Admin...</div>

  if (!isAdmin) {
    return <LoginScreen onSuccess={handleLoginSuccess} />
  }

  const cat  = CATS.find(c => c.key === activeTab)
  const vals = menuState.nutrition[activeTab] || {}
  const displayIndex = photos.length > 0 ? photoIndex % photos.length : 0

  return (
    <div className="wrap">
      <Topbar
        isAdmin={isAdmin}
        onLogout={handleLogout}
        onEdit={() => setModal('edit')}
        onResetPassword={() => setModal('password')}
      />
      <div className="hero">
        <div className="hero-kicker">Today's Menu (Admin)</div>
        <h1>{menuState.title}</h1>
        <div className="date">{fmtDate(menuState.date)}</div>
      </div>

      {/* PHOTO */}
      <div className="photo-card">
        {photos.length > 0 ? (
          <div className="slideshow">
            <img src={photos[displayIndex]} alt={`Foto menu ${displayIndex + 1}`} />
            {photos.length > 1 && (
              <div className="slideshow-controls">
                <button className="slideshow-btn" onClick={() => setPhotoIndex(prev => (prev - 1 + photos.length) % photos.length)} aria-label="Foto sebelumnya">‹</button>
                <div className="slideshow-dots">
                  {photos.map((_, idx) => (
                    <span key={idx} className={`slideshow-dot${idx === photoIndex ? ' active' : ''}`} />
                  ))}
                </div>
                <button className="slideshow-btn" onClick={() => setPhotoIndex(prev => (prev + 1) % photos.length)} aria-label="Foto berikutnya">›</button>
              </div>
            )}
          </div>
        ) : (
          <div className="photo-empty">
            Belum ada foto menu — tekan Edit Menu untuk menambahkan
          </div>
        )}
      </div>

      {/* MENU LIST */}
      <div className="section-label">MENU HARI INI</div>
      <div className="menu-list">
        {(menuState.menuItems || []).map((item, i) => (
          <div className="menu-item" key={i}>{item}</div>
        ))}
      </div>

      {/* NUTRITION */}
      <div className="section-label">KANDUNGAN GIZI</div>
      <div className="tabs">
        {CATS.map(c => (
          <div
            key={c.key}
            className={`tab${c.key === activeTab ? ' active' : ''}`}
            onClick={() => setActiveTab(c.key)}
          >
            {c.key === 'balita' ? 'Balita' : c.key === 'bumil' ? 'Bumil/Busui' : c.key === 'k1' ? 'Porsi Kecil' : 'Porsi Besar'}
          </div>
        ))}
      </div>
      <div className="nutri-card">
        <div className="nutri-tag">{cat.label.toUpperCase()}</div>
        {FIELDS.map(f => (
          <div className="nutri-row" key={f.key}>
            <span>{f.label}</span>
            <span className="nutri-val">{vals[f.key] || '—'}</span>
          </div>
        ))}
      </div>

      {/* QR CODE GENERATOR SECTION */}
      <QRCodeSection showToast={showToast} />

      {/* MODALS */}
      {modal === 'edit' && (
        <EditModal
          state={menuState}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'password' && (
        <PasswordModal onClose={() => setModal(null)} />
      )}

      {consentBanner}
      <Toast message={toast} />
    </div>
  )
}
