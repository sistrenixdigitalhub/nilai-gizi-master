import { promises as fs } from 'fs'
import path from 'path'

const FILE_PATH = path.join('/tmp', 'sppg-data', 'menu.json')
const STORAGE_KEY = 'sppg-menu-current'
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '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'
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY || 'sistrenixdigitalhub/nilai-gizi-master'
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main'

// Increase body size limit for image uploads
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb',
    },
  },
}

const DEFAULT_MENU = {
  date: '',
  title: '',
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
async function ghHeaders() {
  return {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'nilai-gizi-sppg',
    'Cache-Control': 'no-cache',
    'Content-Type': 'application/json',
  }
}

async function ghGetSha(filePath) {
  try {
    const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/contents/${filePath}`
    const res = await fetch(url, { headers: await ghHeaders() })
    if (!res.ok) return null
    const json = await res.json()
    return json.sha || null
  } catch {
    return null
  }
}

async function ghReadJson(filePath) {
  try {
    const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/contents/${filePath}?t=${Date.now()}`
    const res = await fetch(url, { headers: await ghHeaders() })
    if (!res.ok) return null
    const json = await res.json()
    if (!json.content) return null
    const decoded = Buffer.from(json.content.replace(/\n/g, ''), 'base64').toString('utf-8')
    return { data: JSON.parse(decoded), sha: json.sha }
  } catch {
    return null
  }
}

async function ghWriteFile(filePath, contentBase64, sha, commitMsg) {
  try {
    const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/contents/${filePath}`
    if (!sha) sha = await ghGetSha(filePath)
    const body = {
      message: commitMsg || `update ${filePath}`,
      content: contentBase64,
      branch: GITHUB_BRANCH,
    }
    if (sha) body.sha = sha
    const res = await fetch(url, {
      method: 'PUT',
      headers: await ghHeaders(),
      body: JSON.stringify(body),
    })
    const result = await res.json()
    return { ok: res.ok, sha: result.content?.sha || null, error: result.message }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

// ── Upload each image as a separate file in GitHub ──
async function uploadImagesToGithub(images) {
  const urls = []
  for (let i = 0; i < images.length; i++) {
    const dataUrl = images[i]
    if (!dataUrl) continue

    // Parse base64 from data URL
    const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/)
    if (!match) { urls.push(dataUrl); continue }

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1]
    const base64Content = match[2]
    const filePath = `data/images/photo-${i}.${ext}`

    const result = await ghWriteFile(
      filePath,
      base64Content,
      null,
      `update menu photo ${i}`
    )

    if (result.ok) {
      // Use raw GitHub URL for the image
      urls.push(`https://raw.githubusercontent.com/${GITHUB_REPOSITORY}/${GITHUB_BRANCH}/${filePath}?t=${Date.now()}`)
    } else {
      // Fallback: keep original data URL if upload failed
      urls.push(dataUrl)
    }
  }
  return urls
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
      const gh = await ghReadJson('data/menu.json')
      const menu = (gh && gh.data) ? gh.data : DEFAULT_MENU
      return res.status(200).json({
        value: JSON.stringify(menu),
        persistent: true,
      })
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  // POST — save menu (with optional image upload to GitHub)
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

      // Accept { key, value } format
      let menuObj = null
      if (body?.key === STORAGE_KEY && body?.value) {
        menuObj = typeof body.value === 'string' ? JSON.parse(body.value) : body.value
      } else if (body?.title !== undefined || body?.menuItems !== undefined) {
        menuObj = body
      } else {
        return res.status(400).json({ error: 'Missing menu data' })
      }

      // Upload images to GitHub as real files, replace base64 with raw URLs
      if (Array.isArray(menuObj.images) && menuObj.images.length > 0) {
        const base64Images = menuObj.images.filter(img => img && img.startsWith('data:'))
        if (base64Images.length > 0) {
          const uploadedUrls = await uploadImagesToGithub(menuObj.images)
          menuObj = {
            ...menuObj,
            images: uploadedUrls,
            image: uploadedUrls[0] || '',
          }
        }
      }

      // Read current sha for menu.json
      const existing = await ghReadJson('data/menu.json')
      const sha = existing?.sha || null

      // Save clean menu.json (no base64, just URLs)
      const menuContent = Buffer.from(JSON.stringify(menuObj, null, 2), 'utf-8').toString('base64')
      const result = await ghWriteFile('data/menu.json', menuContent, sha, `update menu: ${menuObj.title || 'untitled'}`)

      // Cache to /tmp
      try {
        await fs.mkdir(path.dirname(FILE_PATH), { recursive: true })
        await fs.writeFile(FILE_PATH, JSON.stringify(menuObj, null, 2), 'utf-8')
      } catch {}

      return res.status(200).json({
        ok: result.ok,
        persistent: true,
        imageUrls: menuObj.images,
        error: result.error,
      })
    } catch (err) {
      return res.status(500).json({ error: err.message, persistent: false })
    }
  }

  res.setHeader('Allow', 'GET, POST, OPTIONS')
  return res.status(405).json({ error: 'Method not allowed' })
}
