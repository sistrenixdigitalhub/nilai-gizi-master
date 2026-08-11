import storageHandler from './storage.js'

export default async function handler(req, res) {
  if (req.method === 'GET') {
    req.query = { ...req.query, key: 'sppg-menu-current' }
    // Wrap handler to return { success: true, data: val }
    const originalJson = res.json.bind(res)
    res.json = (body) => {
      if (body && body.value) {
        try {
          const parsed = typeof body.value === 'string' ? JSON.parse(body.value) : body.value
          return originalJson({ success: true, data: parsed })
        } catch {
          return originalJson({ success: true, data: body.value })
        }
      }
      return originalJson(body)
    }
    return storageHandler(req, res)
  }

  if (req.method === 'POST') {
    let body = req.body
    if (typeof body === 'string') {
      try { body = JSON.parse(body) } catch {}
    }
    req.body = { key: 'sppg-menu-current', value: body }
    return storageHandler(req, res)
  }

  return storageHandler(req, res)
}
