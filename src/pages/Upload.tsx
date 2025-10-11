import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { UploadProgress } from '../components/UploadProgress'
import { UploadAnalytics } from '../components/UploadAnalytics'
import { FileDropZone } from '../components/FileDropZone'
import { getFileStatus, testUpload, uploadFileWithProgress, wsUrl, resetStuckFile } from '../lib/api'
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
  const websockets = useRef<Map<number, WebSocket>>(new Map())
  const abortControllers = useRef<Map<number, AbortController>>(new Map())
  const hasLoadedPersistedUploads = useRef(false)
  
  // Upload management state
  const [uploads, setUploads] = useState<Map<number, UploadProgressData>>(new Map())
  const [activeUploads, setActiveUploads] = useState<number[]>([])
  const [completedUploads, setCompletedUploads] = useState<number[]>([])
  const [failedUploads, setFailedUploads] = useState<number[]>([])
  
  // Legacy state for backward compatibility
  const [progress, setProgress] = useState<string>('-')
  const [connecting, setConnecting] = useState(false)
  const [redirecting, setRedirecting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string>()
  const { addFile } = useDatasets()
  const navigate = useNavigate()
  const { showToast } = useToast()

  async function handleUpload(file: File) {
    setUploading(true)
    setError(undefined)
    
    try {
      // Use the new tracking system
      await startUploadWithTracking(file)
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
        setProgress('resuming...')
        connectWs(id)
      } else if (status.status === 'processed') {
        // File is already processed, show option to go to query or upload new
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
    let reconnectAttempts = 0
    const maxReconnectAttempts = 5
    
    const connect = () => {
      socket.onopen = () => {
        console.log(`WebSocket connected for file ${fileId}`)
        reconnectAttempts = 0
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
            case 'massive_file_progress':
              // If backend does not send percentage, approximate from processed_rows
              if (typeof data.percentage === 'number') {
                progress = Math.min(90, 20 + Math.max(0, data.percentage) * 0.7)
              } else if (typeof data.processed_rows === 'number' && data.total_rows) {
                progress = Math.min(90, 20 + (data.processed_rows / Math.max(1, data.total_rows)) * 70)
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
              progress = 0
          }

          // Update progress using direct state updates to avoid dependency issues
          setUploads(prev => {
            const newUploads = new Map(prev)
            const current = newUploads.get(fileId)
            if (current) {
              newUploads.set(fileId, {
                ...current,
                status: data.type === 'processing_complete' ? 'completed' : 'processing',
                progress,
                totalRows: data.total_rows ?? current.totalRows,
                processedRows: data.processed_rows ?? current.processedRows,
                details: {
                  elasticsearchSynced: data.elasticsearch_synced ?? current.details?.elasticsearchSynced,
                  googleCloudSearchSynced: data.google_cloud_search_synced ?? current.details?.googleCloudSearchSynced,
                  bulkSearchReady: data.bulk_search_ready ?? current.details?.bulkSearchReady,
                  processingStage: data.processing_stage ?? current.details?.processingStage
                }
              })
            }
            return newUploads
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
      }
      
      socket.onclose = (event) => {
        console.log(`WebSocket closed for file ${fileId}, code: ${event.code}`)
        websockets.current.delete(fileId)
        
        // Attempt to reconnect if not a normal closure and file is still processing
        if (event.code !== 1000 && reconnectAttempts < maxReconnectAttempts) {
          // Check current upload status without depending on uploads state
          setUploads(prev => {
            const upload = prev.get(fileId)
            if (upload && (upload.status === 'processing' || upload.status === 'uploading')) {
              reconnectAttempts++
              console.log(`Attempting to reconnect WebSocket for file ${fileId} (attempt ${reconnectAttempts}/${maxReconnectAttempts})`)
              
              window.setTimeout(() => {
                const newSocket = new WebSocket(wsUrl(`/api/v1/ws/${fileId}`))
                websockets.current.set(fileId, newSocket)
                connect()
              }, Math.min(1000 * Math.pow(2, reconnectAttempts), 10000)) // Exponential backoff, max 10s
            }
            return prev // Return unchanged state
          })
        }
      }
    }
    
    connect()
    websockets.current.set(fileId, socket)
  }, [showToast])

  // Enhanced upload management functions
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
      // Show initial progress
      updateUploadProgress(tempFileId, { progress: 5, status: 'uploading' })
      
      // Use enhanced upload with detailed progress tracking
      const result = await uploadFileWithProgress(file, abortController.signal, (progress) => {
        updateUploadProgress(tempFileId, {
          progress: progress.percentage,
          status: 'uploading',
          currentChunk: progress.currentChunk,
          totalChunks: progress.totalChunks,
          uploadSpeed: progress.speed,
          estimatedTime: progress.eta
        })
      })
      
      if (!result) {
        throw new Error('Upload failed - no result returned')
      }
      
      // Update with real file ID
      setUploads(prev => {
        const newUploads = new Map(prev)
        const current = newUploads.get(tempFileId)
        if (current && result.id) {
          newUploads.delete(tempFileId)
          newUploads.set(result.id, { ...current, fileId: result.id, status: 'processing', progress: 100 })
        }
        return newUploads
      })
      setActiveUploads(prev => prev.map(id => id === tempFileId ? (result.id || tempFileId) : id))
      
      // Add to datasets
      if (result.id) {
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
      }
      
      showToast(`File "${result.filename}" uploaded successfully!`, 'success')
      return result.id
    } catch (error) {
      // Handle upload failure
      const errorMessage = error instanceof Error ? error.message : 'Upload failed'
      console.error('Upload failed:', error)
      
      setUploads(prev => {
        const newUploads = new Map(prev)
        const current = newUploads.get(tempFileId)
        if (current) {
          newUploads.set(tempFileId, {
            ...current,
            status: 'failed',
            error: errorMessage
          })
        }
        return newUploads
      })
      setActiveUploads(prev => prev.filter(id => id !== tempFileId))
      setFailedUploads(prev => [...prev, tempFileId])
      
      showToast(`Upload failed: ${errorMessage}`, 'error')
      throw error
    } finally {
      abortControllers.current.delete(tempFileId)
    }
  }, [addFile, showToast, connectWebSocket, updateUploadProgress])

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
    if (hasLoadedPersistedUploads.current) {
      return // Already loaded, prevent infinite loop
    }
    
    const loadPersistedUploads = async () => {
      try {
        hasLoadedPersistedUploads.current = true
        
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
          
          // Check if any files are still processing and reconnect to websockets
          for (const [fileId, upload] of data.uploads) {
            if (upload.status === 'processing') {
              try {
                const status = await getFileStatus(fileId)
                if (status.status === 'processing') {
                  // File is still processing, reconnect to websocket
                  connectWebSocket(fileId)
                  setActiveUploads(prev => [...prev, fileId])
                } else if (status.status === 'processed') {
                  // File completed while away, update status
                  setUploads(prev => {
                    const newUploads = new Map(prev)
                    const current = newUploads.get(fileId)
                    if (current) {
                      newUploads.set(fileId, { ...current, status: 'completed', progress: 100 })
                    }
                    return newUploads
                  })
                  setCompletedUploads(prev => [...prev, fileId])
                } else if (status.status === 'failed') {
                  // File failed while away, update status
                  setUploads(prev => {
                    const newUploads = new Map(prev)
                    const current = newUploads.get(fileId)
                    if (current) {
                      newUploads.set(fileId, { ...current, status: 'failed' })
                    }
                    return newUploads
                  })
                  setFailedUploads(prev => [...prev, fileId])
                }
              } catch (error) {
                console.warn(`Could not check status for file ${fileId}:`, error)
              }
            }
          }
        }
      } catch (error) {
        console.error('Failed to load persisted uploads:', error)
      }
    }
    
    loadPersistedUploads()
  }, []) // Remove connectWebSocket from dependencies

  // Cleanup stale state when component mounts (user returns to page)
  useEffect(() => {
    // Clear any legacy tracking state
    try {
      localStorage.removeItem('upload_tracking_file_id')
    } catch {
      // Ignore localStorage errors
    }
    
    // Reset legacy state
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Upload Dataset</h1>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={clearAllUploads}
            className="text-red-600 border-red-300 hover:bg-red-50"
          >
            Clear All
          </Button>
        </div>
      </div>

      {/* File Upload Section */}
      <FileDropZone
        onFileSelect={handleUpload}
        onTestUpload={handleTestUpload}
        uploading={uploading}
        disabled={false}
        maxFileSize={500}
        acceptedTypes={['.csv', '.xlsx', '.xls']}
      />

      {/* Error Display */}
      {error && (
        <Card>
          <CardContent className="p-4">
            <div className="bg-red-50 border border-red-200 rounded-md p-3">
              <div className="text-sm text-red-600">{String(error)}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upload Progress Section */}
      {Array.from(uploads.values()).length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Upload Progress</h2>
          
          {/* Active Uploads */}
          {activeUploads.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-blue-600">Active Uploads ({activeUploads.length})</h3>
              {activeUploads.map(fileId => {
                const upload = uploads.get(fileId)
                if (!upload) return null
                
                return (
                  <UploadProgress
                    key={fileId}
                    upload={upload}
                    onCancel={cancelUpload}
                    onRemove={removeUpload}
                    onViewResults={(id) => navigate(`/query?fileId=${id}`)}
                  />
                )
              })}
            </div>
          )}

          {/* Completed Uploads */}
          {completedUploads.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-green-600">Completed Uploads ({completedUploads.length})</h3>
              {completedUploads.map(fileId => {
                const upload = uploads.get(fileId)
                if (!upload) return null
                
                return (
                  <UploadProgress
                    key={fileId}
                    upload={upload}
                    onRemove={removeUpload}
                    onViewResults={(id) => navigate(`/query?fileId=${id}`)}
                  />
                )
              })}
            </div>
          )}

          {/* Failed Uploads */}
          {failedUploads.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-red-600">Failed Uploads ({failedUploads.length})</h3>
              {failedUploads.map(fileId => {
                const upload = uploads.get(fileId)
                if (!upload) return null
                
                return (
                  <UploadProgress
                    key={fileId}
                    upload={upload}
                    onRemove={removeUpload}
                    onRetry={async (id) => {
                      // Retry logic - remove from failed and restart upload
                      const upload = uploads.get(id)
                      if (upload) {
                        setFailedUploads(prev => prev.filter(fileId => fileId !== id))
                        // You could implement retry logic here
                        showToast('Retry functionality coming soon', 'info')
                      }
                    }}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Analytics Section */}
      {Array.from(uploads.values()).length > 0 && (
        <UploadAnalytics
          uploads={uploads}
          activeUploads={activeUploads}
          completedUploads={completedUploads}
          failedUploads={failedUploads}
        />
      )}

      {/* Legacy Status Display */}
      <div className="text-sm text-gray-500 flex items-center gap-2">
        {connecting && <Spinner />}
        {redirecting && <Spinner />}
        {redirecting ? 'Processing complete! Redirecting to Query page...' : 
         connecting ? 'Connecting...' : `Status: ${progress}`}
      </div>
    </div>
  )
}


