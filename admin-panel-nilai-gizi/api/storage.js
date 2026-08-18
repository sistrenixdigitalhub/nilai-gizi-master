import { promises as fs } from 'fs'
import path from 'path'

const FILE_PATH = path.join('/tmp', 'sppg-data', 'menu.json')
const STORAGE_KEY = 'sppg-menu-current'
const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY || 'sistrenixdigitalhub/nilai-gizi-master'
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main'
const GITHUB_RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_REPOSITORY}/${GITHUB_BRANCH}`

// 24-hour TTL in milliseconds
const DATA_TTL_MS = 24 * 60 * 60 * 1000

// Increase body size limit for image uploads
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb',
    },
  },
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function getDefaultMenu() {
  return {
    date: todayIso(),
    title: '',
    image: '',
    images: [],
    menuItems: [],
    savedAt: null,
    nutrition: {
      k1:     { energi: '', protein: '', lemak: '', karbo: '', serat: '' },
      k2:     { energi: '', protein: '', lemak: '', karbo: '', serat: '' },
      balita: { energi: '', protein: '', lemak: '', karbo: '', serat: '' },
      bumil:  { energi: '', protein: '', lemak: '', karbo: '', serat: '' },
    },
  }
}

// ── Check if menu data has expired ──
// Expired if: the date is not today  OR  savedAt is older than 24h
// This catches both old data (no savedAt) and same-day stale saves.
function isExpired(menu) {
  if (!menu) return false
  // If date field doesn't match today → expired (catches old data without savedAt)
  if (menu.date && menu.date !== todayIso()) return true
  // If savedAt exists and is older than 24h → expired
  if (menu.savedAt && Date.now() - new Date(menu.savedAt).getTime() > DATA_TTL_MS) return true
  return false
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

// ── DELETE a file from GitHub ──
async function ghDeleteFile(filePath, sha, commitMsg) {
  try {
    const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/contents/${filePath}`
    if (!sha) sha = await ghGetSha(filePath)
    if (!sha) return { ok: true } // File doesn't exist, nothing to delete
    const body = {
      message: commitMsg || `delete ${filePath}`,
      sha,
      branch: GITHUB_BRANCH,
    }
    const res = await fetch(url, {
      method: 'DELETE',
      headers: await ghHeaders(),
      body: JSON.stringify(body),
    })
    return { ok: res.ok }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

// ── LIST all files in a directory on GitHub ──
async function ghListFiles(dirPath) {
  try {
    const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/contents/${dirPath}?t=${Date.now()}`
    const res = await fetch(url, { headers: await ghHeaders() })
    if (!res.ok) return []
    const json = await res.json()
    if (!Array.isArray(json)) return []
    return json.map(f => ({ name: f.name, path: f.path, sha: f.sha }))
  } catch {
    return []
  }
}

// ── Upload new images to GitHub (delete all old ones first), return fresh URLs ──
async function uploadImagesToGithub(newImages) {
  const timestamp = Date.now()
  const uploadedUrls = []

  // Step 1: List all existing image files in data/images/ (to delete them after upload)
  const existingFiles = await ghListFiles('data/images')

  // Step 2: Upload each NEW base64 image with a unique timestamped filename
  for (let i = 0; i < newImages.length; i++) {
    const dataUrl = newImages[i]
    if (!dataUrl) continue

    // Already a GitHub URL — keep as-is (no re-upload needed)
    if (!dataUrl.startsWith('data:')) {
      uploadedUrls.push(dataUrl)
      continue
    }

    // Parse base64
    const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/)
    if (!match) {
      uploadedUrls.push(dataUrl)
      continue
    }

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1]
    const base64Content = match[2]
    // Unique filename per upload prevents CDN cache collisions
    const filePath = `data/images/photo-${timestamp}-${i}.${ext}`

    const result = await ghWriteFile(filePath, base64Content, null, `upload menu photo ${i + 1}`)

    if (result.ok) {
      uploadedUrls.push(`${GITHUB_RAW_BASE}/${filePath}`)
    } else {
      console.error(`Failed to upload image ${i}:`, result.error)
      uploadedUrls.push(dataUrl) // fallback: keep base64
    }
  }

  // Step 3: Delete all old image files that are NOT in the new upload set
  const keepFilenames = new Set()
  for (const url of uploadedUrls) {
    if (url.includes('data/images/')) {
      const parts = url.split('data/images/')
      if (parts[1]) keepFilenames.add(parts[1].split('?')[0])
    }
  }

  // Fire-and-forget deletions (parallel, don't block the response)
  const deletePromises = existingFiles
    .filter(f => !keepFilenames.has(f.name))
    .map(f => ghDeleteFile(f.path, f.sha, `delete old image: ${f.name}`))

  await Promise.allSettled(deletePromises)

  return uploadedUrls
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

  // GET — return current menu (returns empty/expired if data is older than 24h)
  if (req.method === 'GET') {
    try {
      const gh = await ghReadJson('data/menu.json')
      let menu = (gh && gh.data) ? gh.data : getDefaultMenu()

      // If menu data is expired (not today or >24h old), return clean empty state
      if (isExpired(menu)) {
        menu = { ...getDefaultMenu(), expired: true }
      }

      return res.status(200).json({
        value: JSON.stringify(menu),
        persistent: true,
        expired: isExpired(gh?.data),
      })
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  // POST — save menu (with image upload to GitHub)
  if (req.method === 'POST') {
    try {
      let body = req.body
      if (typeof body === 'string') {
        try { body = JSON.parse(body) } catch (err) { void err }
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

      // Always stamp savedAt so 24h TTL works correctly
      menuObj.savedAt = new Date().toISOString()

      // Upload new images and delete old ones
      if (Array.isArray(menuObj.images)) {
        const hasBase64 = menuObj.images.some(img => img && img.startsWith('data:'))

        if (hasBase64) {
          // Upload new + delete old
          const uploadedUrls = await uploadImagesToGithub(menuObj.images)
          menuObj = {
            ...menuObj,
            images: uploadedUrls,
            image: uploadedUrls[0] || '',
          }
        } else if (menuObj.images.length === 0) {
          // User cleared all images — delete all old image files
          const existingFiles = await ghListFiles('data/images')
          await Promise.allSettled(
            existingFiles.map(f => ghDeleteFile(f.path, f.sha, `delete old image: ${f.name}`))
          )
          menuObj = { ...menuObj, image: '' }
        }
        // else: all images are already GitHub URLs with no new uploads → keep as-is
      }

      // Read current sha for menu.json
      const existing = await ghReadJson('data/menu.json')
      const sha = existing?.sha || null

      // Write clean menu.json (no base64, only raw GitHub URLs)
      const menuContent = Buffer.from(JSON.stringify(menuObj, null, 2), 'utf-8').toString('base64')
      const result = await ghWriteFile(
        'data/menu.json',
        menuContent,
        sha,
        `update menu: ${menuObj.title || 'untitled'} [${menuObj.date || 'no date'}]`
      )

      // Cache to /tmp for fast reads
      try {
        await fs.mkdir(path.dirname(FILE_PATH), { recursive: true })
        await fs.writeFile(FILE_PATH, JSON.stringify(menuObj, null, 2), 'utf-8')
      } catch (err) {
        void err
      }

      return res.status(200).json({
        ok: result.ok,
        persistent: true,
        imageUrls: menuObj.images,
        savedAt: menuObj.savedAt,
        error: result.error || null,
      })
    } catch (err) {
      return res.status(500).json({ error: err.message, persistent: false })
    }
  }

  res.setHeader('Allow', 'GET, POST, OPTIONS')
  return res.status(405).json({ error: 'Method not allowed' })
}
