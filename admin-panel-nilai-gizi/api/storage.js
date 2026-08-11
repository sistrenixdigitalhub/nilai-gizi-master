import { promises as fs } from 'fs'
import path from 'path'

const FILE_PATH = path.join('/tmp', 'sppg-data', 'storage.json')
const STORAGE_KEY = 'sppg-menu-current'
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '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'
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY || 'sistrenixdigitalhub/nilai-gizi-master'
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main'
const GH_FILE_PATH = 'data/storage.json'

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

// ── GITHUB STORAGE ──
async function readGithubStorage() {
  try {
    const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/contents/${GH_FILE_PATH}?ref=${encodeURIComponent(GITHUB_BRANCH)}&t=${Date.now()}`
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'nilai-gizi-sppg',
        'Cache-Control': 'no-cache',
      },
    })
    if (!res.ok) return null
    const json = await res.json()
    if (!json.content) return null
    const decoded = Buffer.from(json.content.replace(/\n/g, ''), 'base64').toString('utf-8')
    return { data: JSON.parse(decoded || '{}'), sha: json.sha }
  } catch {
    return null
  }
}

async function writeGithubStorage(content, sha) {
  try {
    const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/contents/${GH_FILE_PATH}`

    // Get current sha if not provided
    if (!sha) {
      const checkRes = await fetch(url, {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'nilai-gizi-sppg',
        },
      })
      if (checkRes.ok) {
        const existing = await checkRes.json()
        sha = existing.sha
      }
    }

    const body = {
      message: `Update nilai-gizi data [${new Date().toISOString()}]`,
      content: Buffer.from(content, 'utf-8').toString('base64'),
      branch: GITHUB_BRANCH,
    }
    if (sha) body.sha = sha

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'nilai-gizi-sppg',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const result = await res.json()
    return result.content?.sha || null
  } catch {
    return null
  }
}

// ── GET + SAVE STORAGE ──
async function getStorageData() {
  const gh = await readGithubStorage()
  if (gh && gh.data) {
    return { data: gh.data, sha: gh.sha }
  }

  // Fallback: in-memory + /tmp
  try {
    const raw = await fs.readFile(FILE_PATH, 'utf-8')
    return { data: JSON.parse(raw || '{}'), sha: null }
  } catch {
    return { data: { [STORAGE_KEY]: DEFAULT_DATA }, sha: null }
  }
}

async function saveStorageData(data, sha) {
  const content = JSON.stringify(data, null, 2)

  // Primary: write to GitHub
  const newSha = await writeGithubStorage(content, sha)

  // Secondary: also cache to /tmp
  try {
    await fs.mkdir(path.dirname(FILE_PATH), { recursive: true })
    await fs.writeFile(FILE_PATH, content, 'utf-8')
  } catch {
    // Ignore tmp write errors
  }

  return newSha
}

// ── CORS ──
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

// ── HANDLER ──
export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method === 'GET') {
    const key = req.query?.key
      || new URL(req.url, `http://${req.headers.host}`).searchParams.get('key')
      || STORAGE_KEY
    try {
      const { data } = await getStorageData()
      const val = data[key] ?? (key === STORAGE_KEY ? DEFAULT_DATA : null)
      return res.status(200).json({
        value: typeof val === 'object' && val !== null ? JSON.stringify(val) : val,
        persistent: true,
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
            try { resolve(JSON.parse(rawData || '{}')) } catch { resolve({}) }
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
