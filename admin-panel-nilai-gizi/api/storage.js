import { promises as fs } from 'fs'
import path from 'path'

const FILE_PATH = path.join('/tmp', 'sppg-data', 'storage.json')
const STORAGE_KEY = 'sppg-menu-current'
const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY || 'sistrenixdigitalhub/nilai-gizi-master'
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main'

const DEFAULT_DATA = {
  date: new Date().toISOString().slice(0, 10),
  title: '',
  image: '',
  images: [],
  menuItems: [],
  nutrition: {
    k1: { energi: '', protein: '', lemak: '', karbo: '', serat: '' },
    k2: { energi: '', protein: '', lemak: '', karbo: '', serat: '' },
    balita: { energi: '', protein: '', lemak: '', karbo: '', serat: '' },
    bumil: { energi: '', protein: '', lemak: '', karbo: '', serat: '' }
  }
}

if (!globalThis._sppg_store) {
  globalThis._sppg_store = { [STORAGE_KEY]: DEFAULT_DATA }
}

async function readGithubStorage() {
  if (!GITHUB_TOKEN) return null
  try {
    const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/contents/data/storage.json?ref=${encodeURIComponent(GITHUB_BRANCH)}`
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'nilai-gizi-sppg',
      },
    })
    if (!res.ok) return null
    const json = await res.json()
    if (!json.content) return null
    const decoded = Buffer.from(json.content, 'base64').toString('utf-8')
    return { data: JSON.parse(decoded || '{}'), sha: json.sha }
  } catch {
    return null
  }
}

async function writeGithubStorage(content, sha) {
  if (!GITHUB_TOKEN) return null
  try {
    const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/contents/data/storage.json`
    const body = {
      message: 'Update storage.json from Vercel Admin',
      content: Buffer.from(content, 'utf-8').toString('base64'),
      branch: GITHUB_BRANCH,
    }
    if (sha) body.sha = sha
    await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'nilai-gizi-sppg',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch {
    // Ignore GitHub sync error
  }
}

async function getStorageData() {
  const gh = await readGithubStorage()
  if (gh && gh.data) {
    globalThis._sppg_store = { ...globalThis._sppg_store, ...gh.data }
    return { data: globalThis._sppg_store, sha: gh.sha }
  }

  try {
    const raw = await fs.readFile(FILE_PATH, 'utf-8')
    const parsed = JSON.parse(raw || '{}')
    globalThis._sppg_store = { ...globalThis._sppg_store, ...parsed }
  } catch {
    // Keep in-memory
  }
  return { data: globalThis._sppg_store, sha: null }
}

async function saveStorageData(data, sha) {
  globalThis._sppg_store = data
  const content = JSON.stringify(data, null, 2)
  if (GITHUB_TOKEN) {
    await writeGithubStorage(content, sha)
  }
  try {
    await fs.mkdir(path.dirname(FILE_PATH), { recursive: true })
    await fs.writeFile(FILE_PATH, content, 'utf-8')
  } catch {
    // Ignore tmp write errors
  }
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method === 'GET') {
    const key = req.query?.key || new URL(req.url, `http://${req.headers.host}`).searchParams.get('key') || STORAGE_KEY
    try {
      const { data } = await getStorageData()
      const val = data[key] ?? (key === STORAGE_KEY ? DEFAULT_DATA : null)
      return res.status(200).json({
        value: typeof val === 'object' && val !== null ? JSON.stringify(val) : val,
        persistent: true
      })
    } catch (err) {
      return res.status(500).json({ error: err.message, persistent: false })
    }
  }

  if (req.method === 'POST') {
    try {
      let body = req.body
      if (typeof body === 'string') {
        try { body = JSON.parse(body) } catch {}
      }
      if (!body && req.on) {
        body = await new Promise((resolve, reject) => {
          let rawData = ''
          req.on('data', chunk => { rawData += chunk })
          req.on('end', () => {
            try { resolve(JSON.parse(rawData || '{}')) } catch (e) { resolve({}) }
          })
          req.on('error', reject)
        })
      }

      const { key, value } = body || {}
      if (!key) {
        return res.status(400).json({ error: 'Missing key' })
      }

      let parsedValue = value
      if (typeof value === 'string') {
        try { parsedValue = JSON.parse(value) } catch { parsedValue = value }
      }

      const { data, sha } = await getStorageData()
      data[key] = parsedValue
      await saveStorageData(data, sha)

      return res.status(200).json({ ok: true, persistent: true })
    } catch (err) {
      return res.status(500).json({ error: err.message, persistent: false })
    }
  }

  res.setHeader('Allow', 'GET, POST, OPTIONS')
  return res.status(405).json({ error: 'Method not allowed' })
}
