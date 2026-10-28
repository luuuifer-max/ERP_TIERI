const LOCAL_FRONTEND_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173'
]

const normalizeOrigin = (origin) => origin.trim().replace(/\/+$/, '')

const createCorsOptions = (configuredOrigins = process.env.FRONTEND_ORIGINS || '') => {
  const allowedOrigins = new Set([
    ...LOCAL_FRONTEND_ORIGINS,
    ...String(configuredOrigins).split(',').map(normalizeOrigin).filter(Boolean)
  ])

  return {
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true)
      return callback(new Error(`Origen no permitido por CORS: ${origin}`))
    }
  }
}

module.exports = { createCorsOptions }