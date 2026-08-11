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

const DEFAULT_DATA = {
  date: new Date().toISOString().slice(0, 10),
  title: 'Menu Sekolah & B3',
  image: '',
  images: [],
  menuItems: [
    'Nasi putih',
    'Egg rol katsu dan saus bangkok',
    'Kacang tanah goreng',
    'Tumis wortel, kacang panjang dan jagung',
    'Buah anggur'
  ],
  nutrition: {
    k1: { energi: '450', protein: '15', lemak: '12', karbo: '65', serat: '4' },
    k2: { energi: '650', protein: '22', lemak: '18', karbo: '90', serat: '6' },
    balita: { energi: '350', protein: '12', lemak: '10', karbo: '50', serat: '3' },
    bumil: { energi: '750', protein: '28', lemak: '22', karbo: '105', serat: '8' }
  }
}

// Global in-memory cache for serverless instances
if (!globalThis._sppg_store) {
  globalThis._sppg_store = { [STORAGE_KEY]: DEFAULT_DATA }
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
    const val = store[STORAGE_KEY] || DEFAULT_DATA
    res.json({ success: true, data: val })
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
    store[STORAGE_KEY] = newData
    await writeData(store)
    res.json({ success: true, message: 'Data berhasil disimpan', data: newData })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// Storage GET/POST for compatibility
app.get('/api/storage', async (req, res) => {
  const key = req.query.key || STORAGE_KEY
  try {
    const store = await readData()
    const val = store[key] ?? (key === STORAGE_KEY ? DEFAULT_DATA : null)
    res.json({ value: typeof val === 'object' && val !== null ? JSON.stringify(val) : val, persistent: true })
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
    res.json({ ok: true, persistent: true })
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
