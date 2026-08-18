import express from 'express'
import cors from 'cors'
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 5000
const DATA_FILE = path.join('/tmp', 'sppg-data', 'storage.json')
const STORAGE_KEY = 'sppg-menu-current'

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))
app.use(express.json({ limit: '10mb' }))

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

const DATA_TTL_MS = 24 * 60 * 60 * 1000

function getDefaultData() {
  return {
    date: todayIso(),
    title: '',
    image: '',
    images: [],
    menuItems: [],
    savedAt: null,
    nutrition: {
      k1: { energi: '', protein: '', lemak: '', karbo: '', serat: '' },
      k2: { energi: '', protein: '', lemak: '', karbo: '', serat: '' },
      balita: { energi: '', protein: '', lemak: '', karbo: '', serat: '' },
      bumil: { energi: '', protein: '', lemak: '', karbo: '', serat: '' }
    }
  }
}

function isExpired(menu) {
  if (!menu) return false
  if (menu.date && menu.date !== todayIso()) return true
  if (menu.savedAt && Date.now() - new Date(menu.savedAt).getTime() > DATA_TTL_MS) return true
  return false
}

// Global in-memory cache for serverless instances
if (!globalThis._sppg_store) {
  globalThis._sppg_store = { [STORAGE_KEY]: getDefaultData() }
}

async function readData() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8')
    const parsed = JSON.parse(raw || '{}')
    globalThis._sppg_store = { ...globalThis._sppg_store, ...parsed }
    return globalThis._sppg_store
  } catch {
    try {
      await fs.mkdir(path.dirname(DATA_FILE), { recursive: true })
      await fs.writeFile(DATA_FILE, JSON.stringify(globalThis._sppg_store, null, 2), 'utf-8')
    } catch {
      // Ignore write errors if read-only
    }
    return globalThis._sppg_store
  }
}

async function writeData(data) {
  globalThis._sppg_store = data
  try {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true })
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8')
  } catch {
    // Keep in memory
  }
}

// Health Check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'API Nilai Gizi SPPG Binawidya Server Running' })
})

app.get('/api', (req, res) => {
  res.json({ status: 'ok', message: 'API Nilai Gizi SPPG Binawidya Server Running' })
})

// Main Nilai Gizi GET/POST
app.get('/api/nilai-gizi', async (req, res) => {
  try {
    const store = await readData()
    let val = store[STORAGE_KEY] || getDefaultData()
    if (isExpired(val)) {
      val = { ...getDefaultData(), expired: true }
    }
    res.json({ success: true, data: val, expired: isExpired(val) })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

app.post('/api/nilai-gizi', async (req, res) => {
  try {
    const newData = req.body
    if (!newData) {
      return res.status(400).json({ success: false, error: 'Data tidak boleh kosong' })
    }
    const store = await readData()
    const stampedData = {
      ...newData,
      savedAt: new Date().toISOString()
    }
    store[STORAGE_KEY] = stampedData
    await writeData(store)
    res.json({ success: true, message: 'Data berhasil disimpan', data: stampedData })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// Storage GET/POST for compatibility
app.get('/api/storage', async (req, res) => {
  const key = req.query.key || STORAGE_KEY
  try {
    const store = await readData()
    let val = store[key] ?? (key === STORAGE_KEY ? getDefaultData() : null)
    if (key === STORAGE_KEY && isExpired(val)) {
      val = { ...getDefaultData(), expired: true }
    }
    res.json({
      value: typeof val === 'object' && val !== null ? JSON.stringify(val) : val,
      persistent: true,
      expired: key === STORAGE_KEY ? isExpired(store[key]) : false
    })
  } catch (err) {
    res.status(500).json({ error: err.message, persistent: false })
  }
})

app.post('/api/storage', async (req, res) => {
  const { key, value } = req.body
  if (!key) {
    return res.status(400).json({ error: 'Missing key' })
  }
  try {
    const store = await readData()
    let parsedValue = value
    if (typeof value === 'string') {
      try {
        parsedValue = JSON.parse(value)
      } catch {
        parsedValue = value
      }
    }
    if (parsedValue && typeof parsedValue === 'object') {
      parsedValue.savedAt = new Date().toISOString()
    }
    store[key] = parsedValue
    await writeData(store)
    const imageUrls = parsedValue?.images || []
    res.json({ ok: true, persistent: true, imageUrls, savedAt: parsedValue?.savedAt })
  } catch (err) {
    res.status(500).json({ error: err.message, persistent: false })
  }
})

app.post('/api/storage', async (req, res) => {
  const { key, value } = req.body
  if (!key) {
    return res.status(400).json({ error: 'Missing key' })
  }
  try {
    const store = await readData()
    let parsedValue = value
    if (typeof value === 'string') {
      try {
        parsedValue = JSON.parse(value)
      } catch {
        parsedValue = value
      }
    }
    store[key] = parsedValue
    await writeData(store)
    // Include imageUrls in response for compatibility with admin panel
    const imageUrls = parsedValue?.images || []
    res.json({ ok: true, persistent: true, imageUrls })
  } catch (err) {
    res.status(500).json({ error: err.message, persistent: false })
  }
})

// Start server when run directly
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server API Nilai Gizi berjalan di http://localhost:${PORT}`)
  })
}

export default app
