import axios from 'axios'
const getApiBaseUrl = () => {
  // Prefer environment variable
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }

  // Development mode fallback
  if (import.meta.env.MODE === 'development') {
    return 'http://localhost:5173';
  }

  // If env var is missing in production, throw an error instead of silently falling back
  throw new Error('❌ Missing VITE_API_BASE_URL. Please set it in your .env.production');
};

const API_BASE = getApiBaseUrl();

console.log('VITE_API_BASE_URL:', import.meta.env.VITE_API_BASE_URL);
console.log('Final API_BASE_URL:', API_BASE);
console.log('Full API URL:', `${API_BASE}/api`);

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
})

// Developer console logging for API calls and duplicate detection
type ApiMeta = { requestId: string; startedAtMs: number }
declare module 'axios' {
  export interface AxiosRequestConfig { _meta?: ApiMeta }
}

function rid() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4)
}

function requestKey(config: import('axios').AxiosRequestConfig) {
  const method = (config.method || 'get').toUpperCase()
  const url = `${config.baseURL || ''}${config.url || ''}`
  const params = config.params ? JSON.stringify(config.params) : ''
  const data = config.data ? (typeof config.data === 'string' ? config.data : JSON.stringify(config.data)) : ''
  return `${method} ${url} | params:${params} | data:${data}`
}

const recentCalls = new Map<string, number>()
const inflight = new Map<string, AbortController>()
let lastAuthErrorAt = 0
const AUTH_COOLDOWN_MS = 2000

api.interceptors.request.use((config) => {
  const requestId = rid()
  config.headers = config.headers || {}
  ;(config.headers as Record<string, string>)['X-Request-Id'] = requestId
  config._meta = { requestId, startedAtMs: Date.now() }

  const key = requestKey(config)
  const now = Date.now()
  const last = recentCalls.get(key)
  if (last && now - last < 1000) {
    console.warn(`API duplicate within 1s [${requestId}]`, { key, sinceMs: now - last, config })
  }
  recentCalls.set(key, now)

  // 401 cooldown: short-circuit optional
  if (now - lastAuthErrorAt < AUTH_COOLDOWN_MS) {
    // Cancel this request to prevent auth flood
    return Promise.reject(new axios.Cancel(`auth_cooldown: skipping request ${key}`))
  }

  // In-flight deduplication: cancel new identical requests while one is pending
  if (!config.signal) {
    const existing = inflight.get(key)
    if (existing) {
      const controller = new AbortController()
      config.signal = controller.signal
      controller.abort(`deduped: ${key}`)
    } else {
      const controller = new AbortController()
      config.signal = controller.signal
      inflight.set(key, controller)
    }
  }

  console.groupCollapsed(`%cAPI → ${config.method?.toUpperCase() || 'GET'} ${config.baseURL}${config.url} [${requestId}]`, 'color:#0ea5e9')
  console.info('Request', { headers: config.headers, params: config.params, data: config.data })
  console.groupEnd()
  return config
})

api.interceptors.response.use(
  (response) => {
    const meta = response.config._meta
    const requestId = meta?.requestId || 'unknown'
    const durationMs = meta ? Date.now() - meta.startedAtMs : undefined
    const key = requestKey(response.config)
    recentCalls.delete(key)
    const ctrl = inflight.get(key)
    if (ctrl) inflight.delete(key)

    console.groupCollapsed(`%cAPI ← ${response.config.method?.toUpperCase() || 'GET'} ${response.config.baseURL}${response.config.url} [${requestId}] ${durationMs !== undefined ? `in ${durationMs}ms` : ''}`,'color:#10b981')
    console.info('Status', response.status, response.statusText)
    console.info('Response', response.data)
    console.groupEnd()
    return response
  },
  (error) => {
    const cfg = error.config as import('axios').AxiosRequestConfig | undefined
    const meta = cfg?._meta
    const requestId = meta?.requestId || 'unknown'
    const durationMs = meta ? Date.now() - meta.startedAtMs : undefined
    const key = cfg ? requestKey(cfg) : undefined
    if (key) recentCalls.delete(key)
    if (key) {
      const ctrl = inflight.get(key)
      if (ctrl) inflight.delete(key)
    }

    console.groupCollapsed(`%cAPI ✕ ${cfg?.method?.toUpperCase() || 'GET'} ${cfg?.baseURL || ''}${cfg?.url || ''} [${requestId}] ${durationMs !== undefined ? `in ${durationMs}ms` : ''}`,'color:#ef4444')
    console.error('Error', error?.response?.status, error?.response?.data || error.message)
    console.info('Request', { headers: cfg?.headers, params: cfg?.params, data: cfg?.data })
    console.groupEnd()

    // Retry with exponential backoff on network/timeout (up to 2 retries)
    const isTimeout = error.code === 'ECONNABORTED' || /timeout/i.test(error.message || '')
    const isNetwork = !error.response
    const status = error.response?.status
    const shouldRetry = isTimeout || isNetwork || (status && status >= 500 && status < 600)
    const maxRetries = 2
    type CfgWithRetry = import('axios').AxiosRequestConfig & { _retryCount?: number }
    const cfgWithRetry: CfgWithRetry = (cfg || {}) as CfgWithRetry
    cfgWithRetry._retryCount = cfgWithRetry._retryCount || 0
    if (shouldRetry && cfgWithRetry._retryCount < maxRetries) {
      cfgWithRetry._retryCount += 1
      const delay = Math.min(2000 * Math.pow(2, (cfgWithRetry._retryCount || 1) - 1), 8000)
      return new Promise((resolve) => setTimeout(resolve, delay)).then(() => api(cfgWithRetry))
    }

    // 401 handling: set cooldown to prevent flooding
    if (status === 401) {
      lastAuthErrorAt = Date.now()
    }

    return Promise.reject(error)
  }
)

export function setAuthToken(token?: string) {
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`
  } else {
    delete api.defaults.headers.common['Authorization']
  }
}

export async function login(username: string, password: string) {
  const res = await api.post('/api/v1/auth/login', { username, password })
  return res.data as { access_token: string; token_type: string }
}

export async function uploadFile(file: File) {
  const form = new FormData()
  form.append('file', file)
  const res = await api.post('/api/v1/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data as { id: number; filename: string; status: string; size_bytes: number }
}

export async function testUpload() {
  const res = await api.post('/api/v1/upload/test')
  return res.data as { id: number; filename: string; status: string; size_bytes: number }
}

export async function queryDataset(fileId: number, question: string) {
  const res = await api.post('/api/v1/query', { file_id: fileId, question })
  return res.data as Record<string, unknown>
}

export async function searchPartNumber(fileId: number, partNumber: string, page = 1, pageSize = 50, showAll = false) {
  const res = await api.post('/api/v1/query/search-part', { file_id: fileId, part_number: partNumber, page, page_size: pageSize, show_all: showAll })
  return res.data as {
    part_number: string
    total_matches: number
    companies: Record<string, unknown>[]
    page: number
    page_size: number
    total_pages: number
    show_all?: boolean
    message: string
  }
}

export async function getAnalyticsSummary() {
  const res = await api.get('/api/v1/analytics/summary')
  return res.data as { total_queries: number; avg_latency_ms: number }
}

export function wsUrl(path: string) {
  const base = API_BASE.replace(/^http/, 'ws')
  return base + path
}

export async function getFileStatus(fileId: number, signal?: AbortSignal) {
  const res = await api.get(`/api/v1/upload/${fileId}`, { signal })
  return res.data as { id: number; filename: string; status: string; size_bytes: number; rows_count: number }
}

export async function listFiles(signal?: AbortSignal) {
  const res = await api.get('/api/v1/upload/', { signal })
  return res.data as Array<{ 
    id: number
    filename: string
    status: string
    size_bytes: number
    content_type: string
    storage_path?: string
    rows_count: number
  }>
}

export async function deleteFile(fileId: number) {
  const res = await api.delete(`/api/v1/upload/${fileId}`)
  return res.data as { message: string }
}

export async function testSearchEndpoint(fileId: number) {
  const res = await api.get(`/api/v1/query/test-search/${fileId}`)
  return res.data as { 
    status: string
    message?: string
    table_exists: boolean
    table_name?: string
    row_count?: number
    columns?: Array<{ name: string; type: string }>
  }
}


