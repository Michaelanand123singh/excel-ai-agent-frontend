import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Spinner } from '../components/ui/Spinner'
import { getFileStatus, testUpload, uploadFile, wsUrl } from '../lib/api'
import { useDatasets, type Dataset } from '../store/datasets'
import { useToast } from '../hooks/useToast'

export default function UploadPage() {
  const fileInput = useRef<HTMLInputElement>(null)
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
    setError(undefined)
    try {
      const meta = await uploadFile(f)
      setFileId(meta.id)
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
          <div className="flex gap-2">
            <Button 
              onClick={handleUpload} 
              disabled={uploading}
            >
              {uploading ? <Spinner size={16} /> : 'Upload'}
            </Button>
            <Button 
              variant="secondary" 
              onClick={handleTestUpload}
              disabled={uploading}
            >
              {uploading ? <Spinner size={16} /> : 'Use Sample'}
            </Button>
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


