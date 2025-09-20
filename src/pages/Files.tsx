import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Spinner } from '../components/ui/Spinner'
import { useDatasets } from '../store/datasets'
import { deleteFile } from '../lib/api'
import { useToast } from '../hooks/useToast'
import { 
  TrashIcon, 
  DocumentIcon, 
  CloudArrowUpIcon,
  ChartBarIcon,
  ClockIcon
} from '@heroicons/react/24/outline'

// WebSocket URL helper
const wsUrl = (path: string) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.host
  return `${protocol}//${host}${path}`
}

export default function FilesPage() {
  const { files, isLoading, error, loadFiles, removeFile } = useDatasets()
  const [deleting, setDeleting] = useState<number | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [fileProgress, setFileProgress] = useState<Record<number, {
    status: string
    processedRows: number
    totalRows: number
    percentage: number
  }>>({})
  const websocketsRef = useRef<Map<number, WebSocket>>(new Map())
  const navigate = useNavigate()
  const { showToast } = useToast()

  useEffect(() => {
    loadFiles()
  }, [loadFiles])

  // Debug: log files data
  useEffect(() => {
    if (files.length > 0) {
      console.log('Files loaded:', files)
      console.log('First file ID:', files[0]?.id)
    }
  }, [files])

  // Connect to websockets for files that are processing
  useEffect(() => {
    const currentWebsockets = websocketsRef.current
    const processingFiles = files.filter(file => 
      file.status === 'uploaded' || file.status === 'stored'
    )

    // Close websockets for files that are no longer processing
    currentWebsockets.forEach((socket, fileId) => {
      if (!processingFiles.find(f => f.id === fileId)) {
        socket.close()
        currentWebsockets.delete(fileId)
      }
    })

    // Connect to websockets for processing files
    processingFiles.forEach(file => {
      if (!currentWebsockets.has(file.id)) {
        const socket = new WebSocket(wsUrl(`/api/v1/ws/${file.id}`))
        
        socket.onmessage = (evt) => {
          try {
            const data = JSON.parse(evt.data)
            if (data.type && data.file_id === file.id) {
              setFileProgress(prev => ({
                ...prev,
                [file.id]: {
                  status: data.type,
                  processedRows: data.processed_rows || 0,
                  totalRows: data.total_rows || 0,
                  percentage: data.percentage || 0
                }
              }))

              // If processing is complete, close the websocket
              if (data.type === 'processing_complete') {
                socket.close()
                currentWebsockets.delete(file.id)
                // Refresh files to get updated status
                setTimeout(() => loadFiles(), 1000)
              }
            }
          } catch {
            // Ignore JSON parse errors
          }
        }

        socket.onerror = () => {
          socket.close()
          currentWebsockets.delete(file.id)
        }

        currentWebsockets.set(file.id, socket)
      }
    })

    // Cleanup on unmount
    return () => {
      currentWebsockets.forEach(socket => socket.close())
      currentWebsockets.clear()
    }
  }, [files, loadFiles])

  const handleDelete = async (fileId: number, filename: string) => {
    if (!confirm(`Are you sure you want to delete "${filename}"? This action cannot be undone.`)) {
      return
    }

    setDeleting(fileId)
    try {
      await deleteFile(fileId)
      removeFile(fileId)
      showToast(`File "${filename}" deleted successfully`, 'success')
    } catch (err: unknown) {
      const errorMsg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Delete failed'
      showToast(errorMsg, 'error')
    } finally {
      setDeleting(null)
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'processed': return 'text-green-600 bg-green-50'
      case 'stored': return 'text-blue-600 bg-blue-50'
      case 'uploaded': return 'text-yellow-600 bg-yellow-50'
      case 'error': return 'text-red-600 bg-red-50'
      default: return 'text-gray-600 bg-gray-50'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'processed': return <ChartBarIcon className="w-4 h-4" />
      case 'stored': return <CloudArrowUpIcon className="w-4 h-4" />
      case 'uploaded': return <ClockIcon className="w-4 h-4" />
      default: return <DocumentIcon className="w-4 h-4" />
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <Spinner size={32} />
          <p className="mt-4 text-gray-600">Loading files...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">File Management</h1>
        <Card>
          <CardContent>
            <div className="text-center py-8">
              <div className="text-red-600 mb-4">⚠️ Error loading files</div>
              <p className="text-gray-600 mb-4">{error}</p>
              <Button onClick={loadFiles}>Try Again</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">File Management</h1>
          <p className="text-gray-600">Manage your uploaded datasets and perform queries</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={async () => { await loadFiles(); setLastUpdated(new Date()) }}>
            Refresh
          </Button>
          <Button onClick={() => navigate('/upload')}>
            <CloudArrowUpIcon className="w-4 h-4 mr-2" />
            Upload New File
          </Button>
        </div>
      </div>

      {lastUpdated && (
        <div className="text-xs text-gray-500">Last updated: {lastUpdated.toLocaleTimeString()}</div>
      )}

      {files.length === 0 ? (
        <Card>
          <CardContent>
            <div className="text-center py-12">
              <DocumentIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No files uploaded yet</h3>
              <p className="text-gray-600 mb-6">Upload your first Excel file to get started with data analysis</p>
              <Button onClick={() => navigate('/upload')}>
                <CloudArrowUpIcon className="w-4 h-4 mr-2" />
                Upload Your First File
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {files.map((file) => (
            <Card key={file.id} className="hover:shadow-lg transition-shadow">
              <div className="px-5 py-4 border-b">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <DocumentIcon className="w-8 h-8 text-blue-600" />
                    <div className="min-w-0 flex-1">
                      <h3 className="font-medium text-gray-900 truncate" title={file.filename}>
                        {file.filename}
                      </h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs font-mono bg-blue-100 px-2 py-1 rounded text-blue-800 border">
                          ID: {file.id || 'N/A'}
                        </span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(file.id.toString())
                            showToast(`File ID ${file.id} copied to clipboard`, 'success')
                          }}
                          className="text-xs text-blue-600 hover:text-blue-800 underline"
                          title="Copy file ID"
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => handleDelete(file.id, file.filename)}
                    disabled={deleting === file.id}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 text-sm px-2 py-1"
                  >
                    {deleting === file.id ? <Spinner size={14} /> : <TrashIcon className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(file.status)}`}>
                      {getStatusIcon(file.status)}
                      {file.status}
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Size:</span>
                      <div className="font-medium">{formatFileSize(file.size_bytes)}</div>
                    </div>
                    <div>
                      <span className="text-gray-500">Rows:</span>
                      <div className="font-medium">{file.rows_count.toLocaleString()}</div>
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => navigate(`/query?fileId=${file.id}`)}
                      disabled={file.status !== 'processed'}
                      className="flex-1 text-sm px-3 py-2"
                    >
                      <ChartBarIcon className="w-4 h-4 mr-1" />
                      Query
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => navigate(`/upload?fileId=${file.id}`)}
                      className="flex-1 text-sm px-3 py-2"
                    >
                      <DocumentIcon className="w-4 h-4 mr-1" />
                      Details
                    </Button>
                  </div>
                  
                  {file.status !== 'processed' && (
                    <div className="space-y-2">
                      <div className="text-xs text-yellow-600 bg-yellow-50 p-2 rounded">
                        {file.status === 'uploaded' && 'File is being processed...'}
                        {file.status === 'stored' && 'File is being analyzed...'}
                        {file.status === 'error' && 'Processing failed. Please try uploading again.'}
                      </div>
                      
                      {/* Progress bar for processing files */}
                      {fileProgress[file.id] && (file.status === 'uploaded' || file.status === 'stored') && (
                        <div className="space-y-2">
                          <div className="flex justify-between items-center text-xs">
                            <span className="font-medium text-gray-700">
                              {fileProgress[file.id].status === 'processing_started' && 'Processing started'}
                              {fileProgress[file.id].status === 'download_complete' && 'Download complete, parsing...'}
                              {fileProgress[file.id].status === 'batch_progress' && `Processing batch...`}
                              {fileProgress[file.id].status === 'processing_complete' && 'Processing complete'}
                            </span>
                            <span className="text-gray-500">
                              {fileProgress[file.id].processedRows > 0 && 
                                `${fileProgress[file.id].processedRows.toLocaleString()} rows`}
                            </span>
                          </div>
                          
                          <div className="w-full bg-gray-200 rounded-full h-1.5">
                            <div 
                              className="bg-blue-600 h-1.5 rounded-full transition-all duration-300 ease-out"
                              style={{ width: `${fileProgress[file.id].percentage}%` }}
                            ></div>
                          </div>
                          
                          <div className="flex justify-between text-xs text-gray-500">
                            <span>{fileProgress[file.id].percentage}% complete</span>
                            {fileProgress[file.id].totalRows > 0 && (
                              <span>Total: {fileProgress[file.id].totalRows.toLocaleString()}</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
