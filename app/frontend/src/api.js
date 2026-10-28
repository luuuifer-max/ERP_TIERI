const LOCAL_API_URL = '/api'

const configuredApiUrl = import.meta.env.VITE_API_URL?.trim()

export const API = (configuredApiUrl || LOCAL_API_URL).replace(/\/+$/, '')