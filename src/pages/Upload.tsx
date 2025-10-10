import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Spinner } from '../components/ui/Spinner'
import { getFileStatus, testUpload, uploadFile, wsUrl, resetStuckFile } from '../lib/api'
import { useDatasets, type Dataset } from '../store/datasets'
import { useToast } from '../hooks/useToast'

interface UploadProgressData {
  fileId: number
  filename: string
  status: 'uploading' | 'processing' | 'completed' | 'failed' | 'cancelled'
  progress: number
  totalRows?: number
  processedRows?: number
  currentChunk?: number
  totalChunks?: number
  uploadSpeed?: number
  estimatedTime?: number
  error?: string
  details?: {
    elasticsearchSynced?: boolean
    googleCloudSearchSynced?: boolean
    bulkSearchReady?: boolean
    processingStage?: string
  }
}

export default function UploadPage() {
  const fileInput = useRef<HTMLInputElement>(null)
  const uploadAbortRef = useRef<AbortController | null>(null)
  const websockets = useRef<Map<number, WebSocket>>(new Map())
  const abortControllers = useRef<Map<number, AbortController>>(new Map())
  
  // Upload management state
  const [uploads, setUploads] = useState<Map<number, UploadProgressData>>(new Map())
  const [activeUploads, setActiveUploads] = useState<number[]>([])
  const [completedUploads, setCompletedUploads] = useState<number[]>([])
  const [failedUploads, setFailedUploads] = useState<number[]>([])
  
  // Legacy state for backward compatibility
  const [fileId, setFileId] = useState<number>()
  const [progress, setProgress] = useState<string>('-')
  const [progressDetails, setProgressDetails] = useState<{
    type?: string
    totalRows?: number
    elasticsearchSynced?: boolean
    googleCloudSearchSynced?: boolean
    bulkSearchReady?: boolean
  }>({})
  const [connecting, setConnecting] = useState(false)
  const [redirecting, setRedirecting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string>()
  const { addFile } = useDatasets()
  const navigate = useNavigate()
  const { showToast } = useToast()

  async function handleUpload() {
    const f = fileInput.current?.files?.[0]
    if (!f) {
      setError('Please select a file')
      return
    }
    
    setUploading(true)
    setError(undefined)
    
    try {
      // Use the new tracking system
      const fileId = await startUploadWithTracking(f)
      
      // Also update legacy state for backward compatibility
      setFileId(fileId)
      try { 
        localStorage.setItem('upload_tracking_file_id', String(fileId)) 
      } catch {
        // Ignore localStorage errors
      }
      
      // Clear file input
      if (fileInput.current) {
        fileInput.current.value = ''
      }
    } catch (err: unknown) {
      let errorMsg = 'Upload failed'
      if (err && typeof err === 'object' && 'response' in err) {
        const response = (err as { response?: { data?: { detail?: string | Array<{ msg?: string }> }; status?: number } }).response
        if (response?.data?.detail) {
          if (Array.isArray(response.data.detail)) {
            errorMsg = response.data.detail.map((d) => d.msg || String(d)).join(', ')
          } else {
            errorMsg = String(response.data.detail)
          }
        } else if (response?.status) {
          errorMsg = `Upload failed with status ${response.status}`
        }
      } else if (err instanceof Error) {
        errorMsg = err.message
      }
      setError(errorMsg)
      showToast(errorMsg, 'error')
    } finally {
      setUploading(false)
    }
  }

  async function handleTestUpload() {
    setUploading(true)
    setError(undefined)
    try {
      const meta = await testUpload()
      setFileId(meta.id)
      const ds: Dataset = {
        id: meta.id,
        filename: meta.filename,
        status: meta.status,
        size_bytes: meta.size_bytes,
        content_type: 'text/csv',
        rows_count: 0,
      }
      addFile(ds)
      connectWs(meta.id)
      showToast(`Sample file "${meta.filename}" uploaded successfully!`, 'success')
    } catch (err: unknown) {
      let errorMsg = 'Test upload failed'
      if (err && typeof err === 'object' && 'response' in err) {
        const response = (err as { response?: { data?: { detail?: string | Array<{ msg?: string }> }; status?: number } }).response
        if (response?.data?.detail) {
          if (Array.isArray(response.data.detail)) {
            errorMsg = response.data.detail.map((d) => d.msg || String(d)).join(', ')
          } else {
            errorMsg = String(response.data.detail)
          }
        } else if (response?.status) {
          errorMsg = `Test upload failed with status ${response.status}`
        }
      } else if (err instanceof Error) {
        errorMsg = err.message
      }
      setError(errorMsg)
      showToast(errorMsg, 'error')
    } finally {
      setUploading(false)
    }
  }

  const connectWs = useCallback((id: number) => {
    setConnecting(true)
    const socket = new WebSocket(wsUrl(`/api/v1/ws/${id}`))
    socket.onopen = () => setConnecting(false)
    socket.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data)
        if (data.type && data.file_id === id) {
          setProgressDetails({
            type: data.type,
            totalRows: data.total_rows,
            elasticsearchSynced: data.elasticsearch_synced,
            googleCloudSearchSynced: data.google_cloud_search_synced,
            bulkSearchReady: data.bulk_search_ready
          })
          
          // Update progress text based on type
          let progressText = data.type
          if (data.total_rows) {
            progressText += ` • ${data.total_rows.toLocaleString()} rows`
          }
          if (data.type === 'processing_complete') {
            progressText += ' • Ready for search!'
          }
          setProgress(progressText)
          
          // Auto-redirect when processing is complete
          if (data.type === 'processing_complete') {
            setRedirecting(true)
            try { 
              localStorage.removeItem('upload_tracking_file_id') 
            } catch {
              // Ignore localStorage errors
            }
            setTimeout(() => navigate(`/query?fileId=${id}`), 1500)
          }
        }
      } catch {
        // Ignore JSON parse errors
      }
    }
    socket.onerror = () => setProgress('ws error')
    // Poll status as a fallback with backoff and cleanup
    let attempts = 0
    let alive = true
    let timer: number | undefined
    const controller = new AbortController()
    const poll = async () => {
      if (!alive) return
      try {
        const s = await getFileStatus(id, controller.signal)
        if (s.status) {
          setProgress(`status: ${s.status}`)
          setProgressDetails({ type: s.status })
        }
        if (s.status === 'processed') {
          alive = false
          setRedirecting(true)
          setTimeout(() => navigate(`/query?fileId=${id}`), 1500)
          return
        }
      } catch {
        // ignore transient errors
      }
      attempts += 1
      const delay = Math.min(3000 * Math.pow(1.5, attempts), 15000)
      timer = window.setTimeout(poll, delay)
    }
    poll()
    // Cleanup on unmount
    const cleanup = () => {
      alive = false
      controller.abort()
      if (timer) window.clearTimeout(timer)
      socket.close()
    }
    // ensure cleanup when leaving page
    window.addEventListener('beforeunload', cleanup as EventListener)
    // store cleanup for effect unmount
    cleanupRef.current = cleanup
    return cleanup
  }, [navigate])

  const cleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    return () => {
      if (cleanupRef.current) cleanupRef.current()
    }
  }, [])

  // On mount, resume tracking if a file id was stored earlier
  useEffect(() => {
    const checkFileStatusAndResume = async (id: number) => {
    try {
      const status = await getFileStatus(id)
      if (status.status === 'processing') {
        setFileId(id)
        setProgress('resuming...')
        connectWs(id)
      } else if (status.status === 'processed') {
        // File is already processed, show option to go to query or upload new
        setFileId(id)
        setProgress('already processed - ready for new upload or go to query')
        showToast('File already processed. You can upload a new file or go to query page.', 'info')
      } else if (status.status === 'failed') {
        // File failed, clear the tracking and allow new uploads
        localStorage.removeItem('upload_tracking_file_id')
        setProgress('previous upload failed - ready for new upload')
        showToast('Previous upload failed. You can now upload a new file.', 'warning')
      } else {
        // Unknown status, clear tracking
        localStorage.removeItem('upload_tracking_file_id')
        setProgress('ready for upload')
      }
    } catch (error) {
      // File not found or error, clear tracking
      localStorage.removeItem('upload_tracking_file_id')
      setProgress('ready for upload')
      console.warn('Could not check file status:', error)
    }
  }

    try {
      const saved = localStorage.getItem('upload_tracking_file_id')
      const id = saved ? parseInt(saved) : undefined
      if (id && !Number.isNaN(id)) {
        // Check if the file is actually still processing
        checkFileStatusAndResume(id)
      }
    } catch {
      // Ignore localStorage errors
    }
  }, [connectWs, showToast])

  // Prevent accidental navigation while upload request is in-flight to avoid browser aborting the request
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (uploading) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    if (uploading) {
      window.addEventListener('beforeunload', beforeUnload as EventListener)
    }
    return () => {
      window.removeEventListener('beforeunload', beforeUnload as EventListener)
    }
  }, [uploading])

  // Update upload progress
  const updateUploadProgress = useCallback((fileId: number, updates: Partial<UploadProgressData>) => {
    setUploads(prev => {
      const newUploads = new Map(prev)
      const current = newUploads.get(fileId)
      if (current) {
        newUploads.set(fileId, { ...current, ...updates })
      }
      return newUploads
    })
  }, [])

  // Connect to WebSocket for a file
  const connectWebSocket = useCallback((fileId: number) => {
    if (websockets.current.has(fileId)) {
      return // Already connected
    }

    const socket = new WebSocket(wsUrl(`/api/v1/ws/${fileId}`))
    
    socket.onopen = () => {
      console.log(`WebSocket connected for file ${fileId}`)
    }
    
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (!data || data.file_id !== fileId) return

        // Map stages to progress for smoother UX
        let progress = 0
        switch (data.type) {
          case 'processing_started':
            progress = 5
            break
          case 'download_complete':
            progress = 15
            break
          case 'data_processing_started':
            progress = 20
            break
          case 'batch_progress':
            // If backend does not send percentage, approximate from processed_rows
            if (typeof data.percentage === 'number') {
              progress = Math.min(90, 20 + Math.max(0, data.percentage) * 0.7)
            } else if (typeof data.processed_rows === 'number' && typeof uploads.get(fileId)?.totalRows === 'number' && uploads.get(fileId)?.totalRows) {
              const totalRows = uploads.get(fileId)!.totalRows!
              progress = Math.min(90, 20 + (data.processed_rows / Math.max(1, totalRows)) * 70)
            } else {
              progress = 50
            }
            break
          case 'postgresql_storage_complete':
            progress = 90
            break
          case 'elasticsearch_sync_started':
            progress = 95
            break
          case 'processing_complete':
            progress = 100
            break
          default:
            progress = uploads.get(fileId)?.progress ?? 0
        }

        updateUploadProgress(fileId, {
          status: data.type === 'processing_complete' ? 'completed' : 'processing',
          progress,
          totalRows: data.total_rows ?? uploads.get(fileId)?.totalRows,
          processedRows: data.processed_rows ?? uploads.get(fileId)?.processedRows,
          details: {
            elasticsearchSynced: data.elasticsearch_synced ?? uploads.get(fileId)?.details?.elasticsearchSynced,
            googleCloudSearchSynced: data.google_cloud_search_synced ?? uploads.get(fileId)?.details?.googleCloudSearchSynced,
            bulkSearchReady: data.bulk_search_ready ?? uploads.get(fileId)?.details?.bulkSearchReady,
            processingStage: data.processing_stage ?? uploads.get(fileId)?.details?.processingStage
          }
        })

        if (data.type === 'processing_complete') {
          // Mark as completed
          setActiveUploads(prev => prev.filter(id => id !== fileId))
          setCompletedUploads(prev => [...prev, fileId])
          
          // Close websocket
          socket.close()
          websockets.current.delete(fileId)
          
          showToast(`File processing completed!`, 'success')
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error)
      }
    }
    
    socket.onerror = (error) => {
      console.error(`WebSocket error for file ${fileId}:`, error)
      socket.close()
      websockets.current.delete(fileId)
    }
    
    socket.onclose = () => {
      console.log(`WebSocket closed for file ${fileId}`)
      websockets.current.delete(fileId)
    }
    
    websockets.current.set(fileId, socket)
  }, [showToast, updateUploadProgress, uploads])

  // Upload management functions
  const startUploadWithTracking = useCallback(async (file: File) => {
    const abortController = new AbortController()
    const tempFileId = Date.now() // Temporary ID until we get the real one
    
    // Create initial upload state
    const uploadData: UploadProgressData = {
      fileId: tempFileId,
      filename: file.name,
      status: 'uploading',
      progress: 0,
      currentChunk: 0,
      totalChunks: Math.ceil(file.size / (20 * 1024 * 1024)) // Estimate chunks
    }
    
    setUploads(prev => new Map(prev).set(tempFileId, uploadData))
    setActiveUploads(prev => [...prev, tempFileId])
    abortControllers.current.set(tempFileId, abortController)
    
    try {
      const result = await uploadFile(file, abortController.signal)
      
      // Update with real file ID
      setUploads(prev => {
        const newUploads = new Map(prev)
        const current = newUploads.get(tempFileId)
        if (current) {
          newUploads.delete(tempFileId)
          newUploads.set(result.id, { ...current, fileId: result.id, status: 'processing', progress: 100 })
        }
        return newUploads
      })
      setActiveUploads(prev => prev.map(id => id === tempFileId ? result.id : id))
      
      // Add to datasets
      addFile({
        id: result.id,
        filename: result.filename,
        status: result.status,
        size_bytes: result.size_bytes,
        content_type: file.type || 'application/octet-stream',
        rows_count: 0
      })
      
      // Connect to WebSocket for processing updates
      connectWebSocket(result.id)
      
      showToast(`File "${result.filename}" uploaded successfully!`, 'success')
      return result.id
    } catch (error) {
      // Handle upload failure
      setUploads(prev => {
        const newUploads = new Map(prev)
        const current = newUploads.get(tempFileId)
        if (current) {
          newUploads.set(tempFileId, {
            ...current,
            status: 'failed',
            error: error instanceof Error ? error.message : 'Upload failed'
          })
        }
        return newUploads
      })
      setActiveUploads(prev => prev.filter(id => id !== tempFileId))
      setFailedUploads(prev => [...prev, tempFileId])
      
      showToast(`Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error')
      throw error
    } finally {
      abortControllers.current.delete(tempFileId)
    }
  }, [addFile, showToast, connectWebSocket])

  // Cancel an upload
  const cancelUpload = useCallback(async (fileId: number) => {
    try {
      // First, try to cancel on the server side
      try {
        await resetStuckFile(fileId)
        console.log(`Server-side cancellation requested for file ${fileId}`)
      } catch (error) {
        console.warn(`Could not cancel file ${fileId} on server:`, error)
        // Continue with client-side cancellation even if server call fails
      }
      
      // Cancel client-side HTTP requests
      const abortController = abortControllers.current.get(fileId)
      if (abortController) {
        abortController.abort()
        abortControllers.current.delete(fileId)
      }
      
      // Close WebSocket
      const socket = websockets.current.get(fileId)
      if (socket) {
        socket.close()
        websockets.current.delete(fileId)
      }
      
      // Update UI state
      setUploads(prev => {
        const newUploads = new Map(prev)
        const current = newUploads.get(fileId)
        if (current) {
          newUploads.set(fileId, { ...current, status: 'cancelled' })
        }
        return newUploads
      })
      
      setActiveUploads(prev => prev.filter(id => id !== fileId))
      showToast('Upload cancelled', 'info')
    } catch (error) {
      console.error('Error cancelling upload:', error)
      showToast('Error cancelling upload', 'error')
    }
  }, [showToast])

  // Remove an upload from the list
  const removeUpload = useCallback((fileId: number) => {
    setUploads(prev => {
      const newUploads = new Map(prev)
      newUploads.delete(fileId)
      return newUploads
    })
    setActiveUploads(prev => prev.filter(id => id !== fileId))
    setCompletedUploads(prev => prev.filter(id => id !== fileId))
    setFailedUploads(prev => prev.filter(id => id !== fileId))
  }, [])

  // Clear all uploads and reset state
  const clearAllUploads = useCallback(async () => {
    try {
      // Cancel all active uploads on server
      for (const fileId of activeUploads) {
        try {
          await resetStuckFile(fileId)
        } catch (error) {
          console.warn(`Could not cancel file ${fileId} on server:`, error)
        }
      }
      
      // Clear all client-side state
      abortControllers.current.forEach(controller => controller.abort())
      abortControllers.current.clear()
      
      websockets.current.forEach(socket => socket.close())
      websockets.current.clear()
      
      // Reset all state
      setUploads(new Map())
      setActiveUploads([])
      setCompletedUploads([])
      setFailedUploads([])
      setFileId(undefined)
      setProgress('ready for upload')
      setError(undefined)
      setRedirecting(false)
      setConnecting(false)
      setUploading(false)
      
      // Clear localStorage
      try {
        localStorage.removeItem('active_uploads')
        localStorage.removeItem('upload_tracking_file_id')
      } catch {
        // Ignore localStorage errors
      }
      
      showToast('All uploads cleared', 'success')
    } catch (error) {
      console.error('Error clearing uploads:', error)
      showToast('Error clearing uploads', 'error')
    }
  }, [activeUploads, showToast])

  // Load persisted uploads from localStorage on mount
  useEffect(() => {
    try {
      const persisted = localStorage.getItem('active_uploads')
      if (persisted) {
        const data = JSON.parse(persisted)
        
        // Only restore completed/failed uploads, not active ones
        // Active uploads should be cleared when user returns to page
        setUploads(new Map(data.uploads))
        setCompletedUploads(data.completedUploads || [])
        setFailedUploads(data.failedUploads || [])
        
        // Clear active uploads to prevent ghost uploads
        setActiveUploads([])
        
        // Don't reconnect to websockets for old uploads
        // This prevents showing stale progress
      }
    } catch (error) {
      console.error('Failed to load persisted uploads:', error)
    }
  }, [])

  // Cleanup stale state when component mounts (user returns to page)
  useEffect(() => {
    // Clear any legacy tracking state
    try {
      localStorage.removeItem('upload_tracking_file_id')
    } catch {
      // Ignore localStorage errors
    }
    
    // Reset legacy state
    setFileId(undefined)
    setProgress('ready for upload')
    setError(undefined)
    setRedirecting(false)
    setConnecting(false)
    setUploading(false)
    
    // Clear any stale WebSocket connections
    websockets.current.forEach(socket => socket.close())
    websockets.current.clear()
    
    // Clear any stale abort controllers
    abortControllers.current.forEach(controller => controller.abort())
    abortControllers.current.clear()
  }, [])

  // Persist state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('active_uploads', JSON.stringify({
        uploads: Array.from(uploads.entries()),
        activeUploads,
        completedUploads,
        failedUploads
      }))
    } catch (error) {
      console.error('Failed to persist upload state:', error)
    }
  }, [uploads, activeUploads, completedUploads, failedUploads])

  // Cleanup on unmount
  useEffect(() => {
    // Capture refs at the beginning of the effect
    const currentAbortControllers = abortControllers.current
    const currentWebsockets = websockets.current
    
    return () => {
      // Abort all active uploads
      currentAbortControllers.forEach(controller => controller.abort())
      currentAbortControllers.clear()
      
      // Close all WebSockets
      currentWebsockets.forEach(socket => socket.close())
      currentWebsockets.clear()
    }
  }, [])

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Upload Dataset</h1>
      <Card>
        <CardHeader title="Upload" description="Upload CSV/XLSX, then watch processing progress in real-time." />
        <CardContent>
          <Input 
            ref={fileInput} 
            type="file" 
            accept=".csv,.xlsx,.xls"
            disabled={uploading}
            className="mb-3"
          />
          <div className="flex gap-2 flex-wrap">
            <Button 
              onClick={handleUpload} 
              disabled={uploading}
            >
              {uploading ? <Spinner size={16} /> : 'Upload'}
            </Button>
            {uploading && (
              <Button 
                variant="secondary"
                onClick={() => {
                  try {
                    uploadAbortRef.current?.abort()
                    setUploading(false)
                    setProgress('upload cancelled')
                    showToast('Upload cancelled', 'success')
                  } catch {
                    // Ignore abort errors
                  }
                }}
              >
                Cancel Upload
              </Button>
            )}
            <Button 
              variant="secondary" 
              onClick={handleTestUpload}
              disabled={uploading}
            >
              {uploading ? <Spinner size={16} /> : 'Use Sample'}
            </Button>
            {fileId && !uploading && (
              <>
                <Button 
                  variant="outline" 
                  onClick={async () => {
                    try {
                      // Try to reset the stuck file on the backend
                      await resetStuckFile(fileId)
                      showToast('Reset stuck file on server', 'success')
                    } catch (error) {
                      console.warn('Could not reset file on server:', error)
                    }
                    
                    // Clear local state regardless
                    localStorage.removeItem('upload_tracking_file_id')
                    setFileId(undefined)
                    setProgress('ready for upload')
                    setError(undefined)
                    showToast('Cleared stuck upload. Ready for new file.', 'success')
                  }}
                  className="text-orange-600 border-orange-300 hover:bg-orange-50"
                >
                  Clear Stuck Upload
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => {
                    navigate(`/query?fileId=${fileId}`)
                  }}
                  className="text-blue-600 border-blue-300 hover:bg-blue-50"
                >
                  Go to Query Page
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => {
                    localStorage.removeItem('upload_tracking_file_id')
                    setFileId(undefined)
                    setProgress('ready for upload')
                    setError(undefined)
                    setRedirecting(false)
                    setConnecting(false)
                    showToast('Ready for new upload', 'success')
                  }}
                  className="text-green-600 border-green-300 hover:bg-green-50"
                >
                  Start Fresh
                </Button>
              </>
            )}
          </div>
          
          {error && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md">
              <div className="text-sm text-red-600">{String(error)}</div>
            </div>
          )}

          {/* Enhanced Upload Progress Tracking */}
          {Array.from(uploads.values()).length > 0 && (
            <div className="mt-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-gray-900">Upload Progress</h3>
                <Button
                  variant="outline"
                  onClick={clearAllUploads}
                  className="text-red-600 border-red-300 hover:bg-red-50 text-sm px-3 py-1"
                >
                  Clear All
                </Button>
              </div>
              
              {/* Active Uploads */}
              {activeUploads.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-blue-600">Active Uploads ({activeUploads.length})</h4>
                  {activeUploads.map(fileId => {
                    const upload = uploads.get(fileId)
                    if (!upload) return null
                    
                    return (
                      <div key={fileId} className="border border-blue-200 rounded-lg p-4 bg-blue-50">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <span className="text-2xl">
                              {upload.status === 'uploading' ? '📤' : '⚙️'}
                            </span>
                            <div>
                              <h5 className="font-medium text-gray-900 truncate max-w-xs">
                                {upload.filename}
                              </h5>
                              <p className="text-sm font-medium text-blue-600">
                                {upload.status.charAt(0).toUpperCase() + upload.status.slice(1)}
                              </p>
                            </div>
                          </div>
                          
                          <Button
                            variant="outline"
                            onClick={() => cancelUpload(fileId)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 text-sm px-3 py-1"
                          >
                            Cancel
                          </Button>
                        </div>

                        {/* Progress Bar */}
                        <div className="mb-3">
                          <div className="flex justify-between text-sm text-gray-600 mb-1">
                            <span>Progress</span>
                            <span>{Math.round(upload.progress)}%</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${upload.progress}%` }}
                            />
                          </div>
                        </div>

                        {/* Upload Details */}
                        {upload.status === 'uploading' && (
                          <div className="space-y-2 text-sm text-gray-600">
                            {upload.currentChunk && upload.totalChunks && (
                              <div className="flex justify-between">
                                <span>Chunk Progress:</span>
                                <span>{upload.currentChunk}/{upload.totalChunks}</span>
                              </div>
                            )}
                            {upload.uploadSpeed && (
                              <div className="flex justify-between">
                                <span>Upload Speed:</span>
                                <span>{(upload.uploadSpeed / (1024*1024)).toFixed(1)}MB/s</span>
                              </div>
                            )}
                            {upload.estimatedTime && (
                              <div className="flex justify-between">
                                <span>Estimated Time:</span>
                                <span>{Math.round(upload.estimatedTime)}s</span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Processing Details */}
                        {upload.status === 'processing' && (
                          <div className="space-y-2 text-sm text-gray-600">
                            {upload.processedRows && upload.totalRows && (
                              <div className="flex justify-between">
                                <span>Rows Processed:</span>
                                <span>{upload.processedRows.toLocaleString()}/{upload.totalRows.toLocaleString()}</span>
                              </div>
                            )}
                            {upload.details?.processingStage && (
                              <div className="flex justify-between">
                                <span>Stage:</span>
                                <span className="capitalize">{upload.details.processingStage}</span>
                              </div>
                            )}
                            {upload.details?.elasticsearchSynced !== undefined && (
                              <div className="flex justify-between">
                                <span>Elasticsearch:</span>
                                <span className={upload.details.elasticsearchSynced ? 'text-green-600' : 'text-yellow-600'}>
                                  {upload.details.elasticsearchSynced ? 'Synced' : 'Syncing...'}
                                </span>
                              </div>
                            )}
                            {upload.details?.bulkSearchReady && (
                              <div className="flex justify-between">
                                <span>Bulk Search:</span>
                                <span className="text-green-600">Ready</span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Loading Spinner */}
                        <div className="flex items-center justify-center mt-3">
                          <Spinner size={16} />
                          <span className="ml-2 text-sm text-gray-600">
                            {upload.status === 'uploading' ? 'Uploading...' : 'Processing...'}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Completed Uploads */}
              {completedUploads.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-green-600">Completed Uploads ({completedUploads.length})</h4>
                  {completedUploads.map(fileId => {
                    const upload = uploads.get(fileId)
                    if (!upload) return null
                    
                    return (
                      <div key={fileId} className="border border-green-200 rounded-lg p-4 bg-green-50">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <span className="text-2xl">✅</span>
                            <div>
                              <h5 className="font-medium text-gray-900 truncate max-w-xs">
                                {upload.filename}
                              </h5>
                              <p className="text-sm font-medium text-green-600">Completed</p>
                            </div>
                          </div>
                          
                          <div className="flex gap-2">
                            <Button
                              onClick={() => navigate(`/query?fileId=${fileId}`)}
                              className="bg-green-600 hover:bg-green-700 text-white text-sm px-3 py-1"
                            >
                              View Results
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => removeUpload(fileId)}
                              className="text-gray-600 hover:text-gray-700 text-sm px-3 py-1"
                            >
                              Remove
                            </Button>
                          </div>
                        </div>

                        {upload.totalRows && (
                          <div className="text-sm text-green-800">
                            {upload.totalRows.toLocaleString()} rows processed successfully!
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Failed Uploads */}
              {failedUploads.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-red-600">Failed Uploads ({failedUploads.length})</h4>
                  {failedUploads.map(fileId => {
                    const upload = uploads.get(fileId)
                    if (!upload) return null
                    
                    return (
                      <div key={fileId} className="border border-red-200 rounded-lg p-4 bg-red-50">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <span className="text-2xl">❌</span>
                            <div>
                              <h5 className="font-medium text-gray-900 truncate max-w-xs">
                                {upload.filename}
                              </h5>
                              <p className="text-sm font-medium text-red-600">Failed</p>
                            </div>
                          </div>
                          
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              onClick={() => removeUpload(fileId)}
                              className="text-gray-600 hover:text-gray-700 text-sm px-3 py-1"
                            >
                              Remove
                            </Button>
                          </div>
                        </div>

                        {upload.error && (
                          <div className="text-sm text-red-800">
                            Error: {upload.error}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
          
          <div className="mt-4 text-sm text-gray-500 flex items-center gap-2">
            {connecting && <Spinner />}
            {redirecting && <Spinner />}
            {redirecting ? 'Processing complete! Redirecting to Query page...' : 
             connecting ? 'Connecting...' : `Progress: ${progress}`}
          </div>
          
          {/* Detailed progress indicators */}
          {progressDetails.type && (
            <div className="mt-3 space-y-2">
              <div className="text-xs text-gray-600 font-medium">Processing Status:</div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs">
                  <div className={`w-2 h-2 rounded-full ${
                    progressDetails.type === 'processing_started' ? 'bg-blue-500' :
                    progressDetails.type === 'download_complete' ? 'bg-green-500' :
                    progressDetails.type === 'processing_complete' ? 'bg-green-500' : 'bg-gray-300'
                  }`}></div>
                  <span className="text-gray-600">
                    {progressDetails.type === 'processing_started' && 'Processing started'}
                    {progressDetails.type === 'download_complete' && 'File downloaded'}
                    {progressDetails.type === 'batch_progress' && 'Processing data...'}
                    {progressDetails.type === 'processing_complete' && 'Processing complete'}
                  </span>
                </div>
                
                {progressDetails.totalRows && (
                  <div className="flex items-center gap-2 text-xs">
                    <div className="w-2 h-2 rounded-full bg-green-500"></div>
                    <span className="text-gray-600">
                      {progressDetails.totalRows.toLocaleString()} rows processed
                    </span>
                  </div>
                )}
                
                <div className="flex items-center gap-2 text-xs">
                  <div className={`w-2 h-2 rounded-full ${
                    progressDetails.elasticsearchSynced ? 'bg-green-500' : 'bg-yellow-500'
                  }`}></div>
                  <span className="text-gray-600">
                    Elasticsearch sync: {progressDetails.elasticsearchSynced ? 'Complete' : 'In progress...'}
                  </span>
                </div>
                
                {progressDetails.bulkSearchReady && (
                  <div className="flex items-center gap-2 text-xs">
                    <div className="w-2 h-2 rounded-full bg-green-500"></div>
                    <span className="text-green-600 font-medium">
                      ✓ Bulk search ready - super fast search enabled!
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
          {fileId && <div className="text-xs text-gray-500">file id: {fileId}</div>}
        </CardContent>
      </Card>
    </div>
  )
}


