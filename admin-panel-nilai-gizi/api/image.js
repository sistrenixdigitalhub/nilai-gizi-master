const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY || 'sistrenixdigitalhub/nilai-gizi-master'
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main'

export const config = {
  api: {
    bodyParser: false,
    responseLimit: '20mb',
  },
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

export default async function handler(req, res) {
  setCors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  // Expects: /api/image?path=data/images/photo-0.jpg
  const { path: filePath } = req.query
  if (!filePath) return res.status(400).json({ error: 'Missing path parameter' })

  // Sanitize path — only allow data/images/
  if (!filePath.startsWith('data/images/') || filePath.includes('..')) {
    return res.status(403).json({ error: 'Access denied' })
  }

  try {
    const apiUrl = `https://api.github.com/repos/${GITHUB_REPOSITORY}/contents/${filePath}?ref=${GITHUB_BRANCH}`
    const ghRes = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'nilai-gizi-sppg',
        'Cache-Control': 'no-cache',
      },
    })

    if (!ghRes.ok) {
      return res.status(ghRes.status).json({ error: 'Image not found' })
    }

    const json = await ghRes.json()
    if (!json.content) return res.status(404).json({ error: 'No content' })

    // Decode base64 content
    const imageBuffer = Buffer.from(json.content.replace(/\n/g, ''), 'base64')

    // Determine content type
    const ext = filePath.split('.').pop().toLowerCase()
    const contentTypeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }
    const contentType = contentTypeMap[ext] || 'image/jpeg'

    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.setHeader('Content-Length', imageBuffer.length)
    return res.status(200).send(imageBuffer)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
