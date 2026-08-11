import { promises as fs } from 'fs'
import path from 'path'

const FILE_PATH = path.join('/tmp', 'sppg-data', 'storage.json')
const STORAGE_KEY = 'sppg-menu-current'
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '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'
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY || 'sistrenixdigitalhub/nilai-gizi-master'
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main'
const GH_FILE_PATH = 'data/menu.json'   // dedicated menu file, no key wrapping

const DEFAULT_MENU = {
  date: '',
  title: '',
  image: '',
  images: [],
  menuItems: [],
  nutrition: {
    k1:     { energi: '', protein: '', lemak: '', karbo: '', serat: '' },
    k2:     { energi: '', protein: '', lemak: '', karbo: '', serat: '' },
    balita: { energi: '', protein: '', lemak: '', karbo: '', serat: '' },
    bumil:  { energi: '', protein: '', lemak: '', karbo: '', serat: '' },
  },
}

// ── GITHUB HELPERS ──
async function ghGet() {
  try {
    const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/contents/${GH_FILE_PATH}?t=${Date.now()}`
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
    return { menu: JSON.parse(decoded), sha: json.sha }
  } catch {
    return null
  }
}

async function ghPut(menuObj, sha) {
  try {
    const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/contents/${GH_FILE_PATH}`

    // Refresh sha in case it changed
    if (!sha) {
      const check = await fetch(url, {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'nilai-gizi-sppg',
        },
      })
      if (check.ok) {
        const ex = await check.json()
        sha = ex.sha
      }
    }

    const content = Buffer.from(JSON.stringify(menuObj, null, 2), 'utf-8').toString('base64')
    const body = {
      message: `update menu [${new Date().toISOString()}]`,
      content,
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

// ── CORS ──
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

// ── HANDLER ──
export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()

  // GET — return current menu
  if (req.method === 'GET') {
    try {
      const gh = await ghGet()
      const menu = (gh && gh.menu) ? gh.menu : DEFAULT_MENU
      return res.status(200).json({
        value: JSON.stringify(menu),
        persistent: true,
      })
    } catch (err) {
      return res.status(500).json({ error: err.message, persistent: false })
    }
  }

  // POST — save new menu
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

      // Accept either { key, value } or direct menu object
      let menuObj = null
      if (body?.key === STORAGE_KEY && body?.value) {
        menuObj = typeof body.value === 'string' ? JSON.parse(body.value) : body.value
      } else if (body?.title !== undefined || body?.menuItems !== undefined) {
        menuObj = body
      } else {
        return res.status(400).json({ error: 'Missing menu data' })
      }

      const gh = await ghGet()
      await ghPut(menuObj, gh?.sha || null)

      // Also cache to /tmp
      try {
        await fs.mkdir(path.dirname(FILE_PATH), { recursive: true })
        await fs.writeFile(FILE_PATH, JSON.stringify(menuObj, null, 2), 'utf-8')
      } catch {}

      return res.status(200).json({ ok: true, persistent: true })
    } catch (err) {
      return res.status(500).json({ error: err.message, persistent: false })
    }
  }

  res.setHeader('Allow', 'GET, POST, OPTIONS')
  return res.status(405).json({ error: 'Method not allowed' })
}
