import axios from 'axios'

// Extend Window interface for runtime API base URL
declare global {
  interface Window {
    __API_BASE_URL__?: string;
  }
}

const getApiBaseUrl = () => {
  // Prefer environment variable
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }

  // Runtime override via global (useful for static hosting like Cloud Run/NGINX)
  if (typeof window !== 'undefined' && typeof window.__API_BASE_URL__ === 'string' && window.__API_BASE_URL__.trim()) {
    return window.__API_BASE_URL__
  }

  // Runtime override via <meta name="api-base" content="https://backend">
  if (typeof document !== 'undefined') {
    const meta = document.querySelector('meta[name="api-base"]') as HTMLMetaElement | null
    const v = meta?.content?.trim()
    if (v) return v
  }

  // Heuristic: if served from a known frontend Cloud Run hostname, derive backend hostname
  if (typeof window !== 'undefined' && window.location?.host) {
    const h = window.location.host
    // Example: excel-ai-agent-frontend-123.run.app -> excel-ai-agent-backends-123.run.app
    if (/excel-ai-agent-frontend-/.test(h) && h.endsWith('.run.app')) {
      const backendHost = h.replace('excel-ai-agent-frontend-', 'excel-ai-agent-backends-')
      return `https://${backendHost}`
    }
  }
 
  // Production heuristic: use current origin if available (but not for frontend domains)
  if (typeof window !== 'undefined' && window.location?.origin) {
    const host = window.location.host
    // Don't use frontend origin for API calls
    if (!/excel-ai-agent-frontend-/.test(host)) {
    return window.location.origin
    }
  }

  // Development mode fallback
  if (import.meta.env.MODE === 'development') {
    return 'http://localhost:8000';
  }

  // Production fallback: try to detect backend from frontend hostname
  if (typeof window !== 'undefined' && window.location?.host) {
    const host = window.location.host
    if (/excel-ai-agent-frontend-/.test(host)) {
      const backendHost = host.replace('excel-ai-agent-frontend-', 'excel-ai-agent-backends-')
      return `https://${backendHost}`
    }
  }

  // Final fallback
  return 'http://localhost:8000'
};

const API_BASE = getApiBaseUrl();
const RAW_API_TIMEOUT = import.meta.env.VITE_API_TIMEOUT ? parseInt(import.meta.env.VITE_API_TIMEOUT) : 120000; // env/default
const API_TIMEOUT = Math.max(RAW_API_TIMEOUT || 0, 60000); // enforce minimum 60s to avoid 30s cutoffs
const API_TIMEOUT_CHUNK = import.meta.env.VITE_API_TIMEOUT_CHUNK ? Math.max(parseInt(import.meta.env.VITE_API_TIMEOUT_CHUNK), 60000) : 120000; // per-chunk timeout

console.log('VITE_API_BASE_URL:', import.meta.env.VITE_API_BASE_URL)
console.log('VITE_API_TIMEOUT:', import.meta.env.VITE_API_TIMEOUT)
console.log('Final API_BASE_URL:', API_BASE)
console.log('Final API_TIMEOUT:', API_TIMEOUT)
console.log('Full API URL:', `${API_BASE}/api`)
console.log('Current host:', typeof window !== 'undefined' ? window.location.host : 'server-side')
console.log('Current origin:', typeof window !== 'undefined' ? window.location.origin : 'server-side')

export const api = axios.create({
  baseURL: API_BASE,
  timeout: API_TIMEOUT,
})

// Separate API instance for uploads without timeout
export const uploadApi = axios.create({
  baseURL: API_BASE,
  // No timeout for uploads
})

export function setRuntimeApiBase(url?: string) {
  if (typeof window === 'undefined') return
  if (url && url.trim()) {
    window.__API_BASE_URL__ = url.trim()
    api.defaults.baseURL = url.trim()
    uploadApi.defaults.baseURL = url.trim()
    console.info('Runtime API base updated to:', url.trim())
  }
}

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

    if (status === 401) {
      lastAuthErrorAt = Date.now()
    }

    return Promise.reject(error)
  }
)

// Add the same interceptors to uploadApi (but without timeout retry logic)
uploadApi.interceptors.request.use((config) => {
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

  console.groupCollapsed(`%cUPLOAD → ${config.method?.toUpperCase() || 'GET'} ${config.baseURL}${config.url} [${requestId}]`, 'color:#0ea5e9')
  console.info('Request', { headers: config.headers, params: config.params, data: config.data })
  console.groupEnd()
  return config
})

uploadApi.interceptors.response.use(
  (response) => {
    const meta = response.config._meta
    const requestId = meta?.requestId || 'unknown'
    const durationMs = meta ? Date.now() - meta.startedAtMs : undefined
    const key = requestKey(response.config)
    recentCalls.delete(key)
    const ctrl = inflight.get(key)
    if (ctrl) inflight.delete(key)

    console.groupCollapsed(`%cUPLOAD ← ${response.config.method?.toUpperCase() || 'GET'} ${response.config.baseURL}${response.config.url} [${requestId}] ${durationMs !== undefined ? `in ${durationMs}ms` : ''}`,'color:#10b981')
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

    console.groupCollapsed(`%cUPLOAD ✕ ${cfg?.method?.toUpperCase() || 'GET'} ${cfg?.baseURL || ''}${cfg?.url || ''} [${requestId}] ${durationMs !== undefined ? `in ${durationMs}ms` : ''}`,'color:#ef4444')
    console.error('Error', error?.response?.status, error?.response?.data || error.message)
    console.info('Request', { headers: cfg?.headers, params: cfg?.params, data: cfg?.data })
    console.groupEnd()

    if (error.response?.status === 401) {
      lastAuthErrorAt = Date.now()
    }

    return Promise.reject(error)
  }
)

export function setAuthToken(token?: string) {
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`
    uploadApi.defaults.headers.common['Authorization'] = `Bearer ${token}`
  } else {
    delete api.defaults.headers.common['Authorization']
    delete uploadApi.defaults.headers.common['Authorization']
  }
}

export async function login(username: string, password: string) {
  const res = await api.post('/api/v1/auth/login', { username, password })
  return res.data as { access_token: string; token_type: string }
}

export async function uploadFile(file: File, signal?: AbortSignal) {
  // Use unified upload endpoint - backend will automatically handle routing
  const form = new FormData()
  form.append('file', file)
  
  try {
    const res = await uploadApi.post('/api/v1/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      signal,
    })
    
    // Check if backend requires chunked upload for large files
    if (res.data.requires_chunked_upload) {
      console.log('Large file detected, switching to chunked upload...')
      console.log(`File size: ${(res.data.file_size / (1024*1024)).toFixed(1)}MB`)
      console.log(`Estimated chunks: ${res.data.estimated_chunks}`)
      console.log(`Chunk size: ${(res.data.max_chunk_size / (1024*1024)).toFixed(1)}MB`)
      return await uploadFileChunked(file, signal, res.data.max_chunk_size)
    }
    
    // Small file processed directly
    return res.data as { id: number; filename: string; status: string; size_bytes: number }
  } catch {
    // If unified upload fails, fall back to chunked upload
    console.log('Unified upload failed, falling back to chunked upload...')
    return await uploadFileChunked(file, signal)
  }
}

async function uploadFileChunked(file: File, signal?: AbortSignal, chunkSize?: number) {
  // Intelligent chunked upload for large files
  // Use provided chunk size or determine optimal size based on file size
  const CHUNK_SIZE = chunkSize || (file.size >= 100 * 1024 * 1024 ? 50 * 1024 * 1024 : 20 * 1024 * 1024)
  
  console.log(`Using chunk size: ${CHUNK_SIZE / (1024*1024)}MB for file size: ${(file.size / (1024*1024)).toFixed(1)}MB`)
  
  // 1) init
  const initRes = await uploadApi.post('/api/v1/upload/multipart/init', {
    filename: file.name,
    content_type: file.type || 'application/octet-stream',
    total_size: file.size,
  }, { signal })
  const { upload_id, file_id } = initRes.data as { upload_id: string; file_id: number }
  
  // 2) send parts
  const totalParts = Math.ceil(file.size / CHUNK_SIZE)
  console.log(`Uploading ${totalParts} chunks of ${CHUNK_SIZE / (1024*1024)}MB each`)
  
  for (let part = 0; part < totalParts; part++) {
    const start = part * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, file.size)
    const blob = file.slice(start, end)
    const arrayBuffer = await blob.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)
    
    // Add progress logging
    const progress = Math.round((part + 1) / totalParts * 100)
    console.log(`Uploading chunk ${part + 1}/${totalParts} (${progress}%) - ${(bytes.length / (1024*1024)).toFixed(1)}MB`)
    
    await uploadApi.post(`/api/v1/upload/multipart/part`, bytes, {
      headers: { 'Content-Type': 'application/octet-stream' },
      params: { upload_id, part_number: part + 1, total_parts: totalParts },
      signal,
    })
  }
  
  // 3) complete
  console.log('Completing chunked upload...')
  const completeRes = await uploadApi.post('/api/v1/upload/multipart/complete', { upload_id }, { signal })
  return { id: file_id, filename: file.name, status: completeRes.data.status, size_bytes: completeRes.data.size_bytes }
}

export async function testUpload() {
  const res = await api.post('/api/v1/upload/test')
  return res.data as { id: number; filename: string; status: string; size_bytes: number }
}

export async function queryDataset(fileId: number, question: string) {
  const res = await api.post('/api/v1/query', { file_id: fileId, question })
  return res.data as Record<string, unknown>
}

export type ApiCompany = {
  company_name: string
  contact_details: string
  email: string
  quantity: number | string
  unit_price: number | string
  uqc: string
  item_description: string
  part_number?: string
  secondary_buyer?: string
  secondary_buyer_contact?: string
  secondary_buyer_email?: string
  confidence?: number
  match_type?: string
  match_status?: string
  confidence_breakdown?: {
    part_number: { score: number; method: string; details: string }
    description: { score: number; method: string; details: string }
    manufacturer: { score: number; method: string; details: string }
    length_penalty: number
  }
}

export type ApiPartSearchResult = {
  part_number: string
  total_matches: number
  companies: ApiCompany[]
  page: number
  page_size: number
  total_pages: number
  show_all?: boolean
  message: string
  cached?: boolean
  latency_ms?: number
  search_mode?: string
  match_type?: string
  search_engine?: string
}

export async function searchPartNumber(fileId: number, partNumber: string, page = 1, pageSize = 1000, showAll = false, searchMode: 'exact' | 'fuzzy' | 'hybrid' = 'hybrid') {
  // Route single search through ES-backed unified path for consistency
  const res = await api.post('/api/v1/query/search-part', { file_id: fileId, part_number: partNumber, page, page_size: pageSize, show_all: showAll, search_mode: searchMode })
  return res.data as ApiPartSearchResult
}

export type ApiBulkPartResults = {
  results: Record<string, ApiPartSearchResult | { error: string }>
  total_parts: number
  latency_ms: number
  file_id: number
}

export async function searchPartNumberBulk(fileId: number, partNumbers: string[], page = 1, pageSize = 1000, showAll = false, searchMode: 'exact' | 'fuzzy' | 'hybrid' = 'hybrid') {
  // Prefer Elasticsearch ultra-fast endpoint for bulk searches
  const res = await api.post('/api/v1/query-elasticsearch/search-part-bulk-elasticsearch', { file_id: fileId, part_numbers: partNumbers, page, page_size: pageSize, show_all: showAll, search_mode: searchMode })
  return res.data as ApiBulkPartResults
}

export async function searchPartNumberBulkUltraFast(fileId: number, partNumbers: string[], page = 1, pageSize = 10000, showAll = true, searchMode: 'exact' | 'fuzzy' | 'hybrid' = 'hybrid') {
  // Keep alias but route to Elasticsearch endpoint
  const res = await api.post('/api/v1/query-elasticsearch/search-part-bulk-elasticsearch', {
    file_id: fileId,
    part_numbers: partNumbers,
    page,
    page_size: pageSize,
    show_all: showAll,
    search_mode: searchMode
  })
  return res.data as ApiBulkPartResults
}

// Chunked bulk search to avoid very large payloads/timeouts, preserving exact response shape
export async function searchPartNumberBulkChunked(
  fileId: number,
  partNumbers: string[],
  page = 1,
  pageSize = 1000,
  showAll = false,
  searchMode: 'exact' | 'fuzzy' | 'hybrid' = 'hybrid',
  opts?: { 
    chunkSize?: number; 
    concurrency?: number; 
    onProgress?: (completed: number, total: number, current: string) => void;
    onResults?: (results: Record<string, ApiPartSearchResult | { error: string }>) => void;
  }
) {
  // Heuristic: for 500+ parts, use smaller slices to keep each request <30s
  const autoChunk = partNumbers.length >= 500 ? 25 : partNumbers.length >= 200 ? 50 : 100
  const chunkSize = opts?.chunkSize ?? autoChunk
  // Adaptive concurrency: keep modest for stability under load
  const baseConcurrency = partNumbers.length > 50000 ? 12 : partNumbers.length > 10000 ? 10 : partNumbers.length >= 500 ? 8 : 6
  const concurrency = Math.max(1, Math.min(opts?.concurrency ?? baseConcurrency, 16))

  const chunks: string[][] = []
  for (let i = 0; i < partNumbers.length; i += chunkSize) {
    chunks.push(partNumbers.slice(i, i + chunkSize))
  }

  const results: Record<string, ApiPartSearchResult | { error: string }> = {}
  let totalLatency = 0
  let completedChunks = 0

  // Simple promise pool with progress tracking
  let idx = 0
  async function worker() {
    while (idx < chunks.length) {
      const myIdx = idx++
      const slice = chunks[myIdx]
      const t0 = Date.now()
      
      // Report progress
      if (opts?.onProgress) {
        opts.onProgress(completedChunks, chunks.length, `Processing chunk ${myIdx + 1}/${chunks.length}...`)
      }
      
      try {
        const res = await api.post('/api/v1/query-elasticsearch/search-part-bulk-elasticsearch', {
          file_id: fileId,
          part_numbers: slice,
          page,
          page_size: pageSize,
          show_all: showAll,
          search_mode: searchMode
        }, { timeout: API_TIMEOUT_CHUNK })
        const data = res.data as ApiBulkPartResults
        Object.assign(results, data.results)
        totalLatency += Date.now() - t0
        completedChunks++
        
        // Stream results immediately as they come in
        if (opts?.onResults) {
          opts.onResults({ ...results }) // Send current results
        }
        
        // Report progress after completion
        if (opts?.onProgress) {
          opts.onProgress(completedChunks, chunks.length, `Completed chunk ${myIdx + 1}/${chunks.length}`)
        }
      } catch (e: unknown) {
        // Mark slice parts with error but continue others
        const msg = (e as Error)?.message || 'Bulk slice failed'
        for (const pn of slice) {
          results[pn] = { error: msg }
        }
        completedChunks++
        
        if (opts?.onProgress) {
          opts.onProgress(completedChunks, chunks.length, `Failed chunk ${myIdx + 1}/${chunks.length}`)
        }
      }
    }
  }

  const workers = new Array(concurrency).fill(0).map(() => worker())
  await Promise.all(workers)

  return {
    results,
    total_parts: partNumbers.length,
    latency_ms: totalLatency,
    file_id: fileId,
  } as ApiBulkPartResults
}

export async function searchPartNumberBulkUpload(fileId: number, file: File) {
  const form = new FormData()
  form.append('file', file)
  form.append('file_id', String(fileId))
  const res = await api.post('/api/v1/query/search-part-bulk-upload', form, { headers: { 'Content-Type': 'multipart/form-data' } })
  return res.data as {
    results: Record<string, unknown>
    total_parts: number
    latency_ms: number
    file_id: number
  }
}

// Richer bulk Excel search that uses Part Number, Part name, Quantity, Manufacturer name
export async function searchBulkExcelUpload(fileId: number, file: File) {
  const form = new FormData()
  form.append('file', file)
  form.append('file_id', String(fileId))
  const res = await api.post('/api/v1/bulk-search/bulk-excel-search', form, { headers: { 'Content-Type': 'multipart/form-data' } })
  return res.data as ApiBulkPartResults & {
    upload_summary: {
      total_parts: number
      found_matches: number
      partial_matches: number
      no_matches: number
      parse_errors: string[]
    }
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

// Elasticsearch sync status and retry functions
export async function getElasticsearchStatus(fileId: number) {
  const res = await api.get(`/api/v1/upload/${fileId}/elasticsearch-status`)
  return res.data as {
    file_id: number
    filename: string
    elasticsearch_synced: boolean
    elasticsearch_sync_error: string | null
    status: 'synced' | 'failed' | 'pending' | 'syncing'
  }
}

export async function retryElasticsearchSync(fileId: number) {
  const res = await api.post(`/api/v1/upload/${fileId}/elasticsearch-retry`)
  return res.data as {
    message: string
    file_id: number
    status: 'syncing'
  }
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

export async function resetStuckFile(fileId: number) {
  const res = await api.patch(`/api/v1/upload/${fileId}/reset`)
  return res.data as { message: string; new_status?: string; current_status?: string }
}

export async function listStuckFiles() {
  const res = await api.get('/api/v1/upload/stuck')
  return res.data as { 
    stuck_files: Array<{
      id: number
      filename: string
      status: string
      size_bytes: number
      content_type: string
      rows_count: number
    }>
    count: number
  }
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

export async function cancelUpload(fileId: number) {
  const res = await api.post(`/api/v1/upload/${fileId}/cancel`)
  return res.data as { status: string; file_id?: number; message?: string }
}

export async function getFileRows(fileId: number, page = 1, pageSize = 100) {
  const res = await api.get(`/api/v1/upload/${fileId}/rows`, { params: { page, page_size: pageSize } })
  return res.data as {
    file_id: number
    table: string
    page: number
    page_size: number
    total_rows: number
    total_pages: number
    columns: string[]
    rows: Array<Record<string, unknown>>
  }
}
