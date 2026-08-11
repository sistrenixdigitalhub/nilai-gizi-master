import express from 'express'
import cors from 'cors'
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 5000
const DATA_FILE = path.join(__dirname, 'data', 'storage.json')
const STORAGE_KEY = 'sppg-menu-current'

app.use(cors())
app.use(express.json({ limit: '10mb' }))

// Helper to ensure data directory and file exist
async function readData() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8')
    return JSON.parse(raw || '{}')
  } catch (err) {
    if (err.code === 'ENOENT') {
      await fs.mkdir(path.dirname(DATA_FILE), { recursive: true })
      const initial = {}
      await fs.writeFile(DATA_FILE, JSON.stringify(initial, null, 2), 'utf-8')
      return initial
    }
    throw err
  }
}

async function writeData(data) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true })
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8')
}

// Health Check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'API Nilai Gizi Server Running' })
})

// Specific endpoint for Nilai Gizi Data
app.get('/api/nilai-gizi', async (req, res) => {
  try {
    const store = await readData()
    const val = store[STORAGE_KEY] || null
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

// Generic storage handler compatibility (/api/storage)
app.get('/api/storage', async (req, res) => {
  const key = req.query.key || STORAGE_KEY
  try {
    const store = await readData()
    const val = store[key] ?? null
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
    // Parse value if stringified JSON
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

app.listen(PORT, () => {
  console.log(`Server API Nilai Gizi berjalan di http://localhost:${PORT}`)
})
