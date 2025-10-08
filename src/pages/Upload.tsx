import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Spinner } from '../components/ui/Spinner'
import { getFileStatus, testUpload, uploadFile, wsUrl, resetStuckFile } from '../lib/api'
import { useDatasets, type Dataset } from '../store/datasets'
import { useToast } from '../hooks/useToast'

export default function UploadPage() {
  const fileInput = useRef<HTMLInputElement>(null)
  const uploadAbortRef = useRef<AbortController | null>(null)
  const [fileId, setFileId] = useState<number>()
  const [progress, setProgress] = useState<string>('-')
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
    uploadAbortRef.current = new AbortController()
    setError(undefined)
    try {
      const meta = await uploadFile(f, uploadAbortRef.current.signal)
      setFileId(meta.id)
      // persist tracking so we can resume progress if user navigates away
      try { localStorage.setItem('upload_tracking_file_id', String(meta.id)) } catch {}
      // Cast minimal upload response into Dataset shape for local state
      const ds: Dataset = {
        id: meta.id,
        filename: meta.filename,
        status: meta.status,
        size_bytes: meta.size_bytes,
        content_type: f.type || 'application/octet-stream',
        rows_count: 0,
      }
      addFile(ds)
      connectWs(meta.id)
      showToast(`File "${meta.filename}" uploaded successfully!`, 'success')
    } catch (err: unknown) {
      const errorMsg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Upload failed'
      setError(errorMsg)
      showToast(errorMsg, 'error')
    } finally {
      setUploading(false)
      uploadAbortRef.current = null
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
      const errorMsg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Test upload failed'
      setError(errorMsg)
      showToast(errorMsg, 'error')
    } finally {
      setUploading(false)
    }
  }

  function connectWs(id: number) {
    setConnecting(true)
    const socket = new WebSocket(wsUrl(`/api/v1/ws/${id}`))
    socket.onopen = () => setConnecting(false)
    socket.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data)
        if (data.type && data.file_id === id) {
          setProgress(`${data.type}${data.total_rows ? ` • total ${data.total_rows}` : ''}`)
          // Auto-redirect when processing is complete
          if (data.type === 'processing_complete') {
            setRedirecting(true)
            try { localStorage.removeItem('upload_tracking_file_id') } catch {}
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
        if (s.status) setProgress(`status: ${s.status}`)
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
  }

  const cleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    return () => {
      if (cleanupRef.current) cleanupRef.current()
    }
  }, [])

  // On mount, resume tracking if a file id was stored earlier
  useEffect(() => {
    try {
      const saved = localStorage.getItem('upload_tracking_file_id')
      const id = saved ? parseInt(saved) : undefined
      if (id && !Number.isNaN(id)) {
        // Check if the file is actually still processing
        checkFileStatusAndResume(id)
      }
    } catch {}
  }, [])

  async function checkFileStatusAndResume(id: number) {
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
                  } catch {}
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
              <div className="text-sm text-red-600">{error}</div>
            </div>
          )}
          
          <div className="mt-4 text-sm text-gray-500 flex items-center gap-2">
            {connecting && <Spinner />}
            {redirecting && <Spinner />}
            {redirecting ? 'Processing complete! Redirecting to Query page...' : 
             connecting ? 'Connecting...' : `Progress: ${progress}`}
          </div>
          {fileId && <div className="text-xs text-gray-500">file id: {fileId}</div>}
        </CardContent>
      </Card>
    </div>
  )
}


