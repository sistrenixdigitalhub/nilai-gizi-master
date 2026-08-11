import { promises as fs } from 'fs'
import path from 'path'

// process.cwd() bersifat read-only di Vercel Serverless Functions.
// /tmp adalah satu-satunya folder yang writable saat runtime, jadi dipakai
// sebagai fallback lokal (bukan pengganti penyimpanan permanen — lihat README).
const FILE_PATH = process.env.VERCEL
  ? path.join('/tmp', 'sppg-data', 'storage.json')
  : path.join(process.cwd(), 'data', 'storage.json')
const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY ||
  (process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}` : null)
const GITHUB_BRANCH = process.env.VERCEL_GIT_COMMIT_REF || (process.env.GITHUB_REF ? process.env.GITHUB_REF.replace('refs/heads/', '') : 'main')

async function ensureLocalDataFile() {
  await fs.mkdir(path.dirname(FILE_PATH), { recursive: true })
  try {
    await fs.access(FILE_PATH)
  } catch {
    await fs.writeFile(FILE_PATH, JSON.stringify({}, null, 2), 'utf-8')
  }
}

async function readLocalStorage() {
  await ensureLocalDataFile()
  const raw = await fs.readFile(FILE_PATH, 'utf-8')
  return JSON.parse(raw || '{}')
}

async function writeLocalStorage(data) {
  await ensureLocalDataFile()
  await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2), 'utf-8')
}

async function readGithubStorage() {
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) return null
  const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/contents/data/storage.json?ref=${encodeURIComponent(GITHUB_BRANCH)}`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'nilai-gizi-sppg',
    },
  })
  if (res.status === 404) return { content: '{}', sha: null }
  if (!res.ok) throw new Error(`GitHub read failed: ${res.status}`)
  return await res.json()
}

async function writeGithubStorage(content, sha) {
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) throw new Error('GitHub repository credentials missing')
  const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/contents/data/storage.json`
  const body = {
    message: 'Update storage.json',
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
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub write failed: ${res.status} ${text}`)
  }
  return await res.json()
}

async function getStorageData() {
  if (GITHUB_TOKEN && GITHUB_REPOSITORY) {
    const res = await readGithubStorage()
    const raw = res.content
    if (!raw) return {}
    const decoded = Buffer.from(raw, 'base64').toString('utf-8')
    return { data: JSON.parse(decoded || '{}'), sha: res.sha }
  }

  const data = await readLocalStorage()
  return { data, sha: null }
}

async function saveStorageData(data, sha) {
  const content = JSON.stringify(data, null, 2)
  if (GITHUB_TOKEN && GITHUB_REPOSITORY) {
    await writeGithubStorage(content, sha)
  } else {
    await writeLocalStorage(data)
  }
}

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

const IS_PERSISTENT = Boolean(GITHUB_TOKEN && GITHUB_REPOSITORY)

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const key = req.url && new URL(req.url, `http://${req.headers.host}`).searchParams.get('key')
    if (!key) {
      return sendJson(res, 400, { error: 'Missing key' })
    }
    try {
      const { data } = await getStorageData()
      return sendJson(res, 200, { value: data[key] ?? null, persistent: IS_PERSISTENT })
    } catch (err) {
      return sendJson(res, 500, { error: err.message, persistent: IS_PERSISTENT })
    }
  }

  if (req.method === 'POST') {
    try {
      const body = await new Promise((resolve, reject) => {
        let data = ''
        req.on('data', chunk => { data += chunk })
        req.on('end', () => resolve(JSON.parse(data || '{}')))
        req.on('error', reject)
      })
      const { key, value } = body
      if (!key) {
        return sendJson(res, 400, { error: 'Missing key' })
      }
      const { data, sha } = await getStorageData()
      data[key] = value
      await saveStorageData(data, sha)
      return sendJson(res, 200, { ok: true, persistent: IS_PERSISTENT })
    } catch (err) {
      return sendJson(res, 500, { error: err.message, persistent: IS_PERSISTENT })
    }
  }

  res.setHeader('Allow', 'GET, POST')
  return sendJson(res, 405, { error: 'Method not allowed' })
}
