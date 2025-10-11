import { Button } from './ui/Button'
import { Spinner } from './ui/Spinner'
import { Badge } from './ui/Badge'

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

interface UploadProgressProps {
  upload: UploadProgressData
  onCancel?: (fileId: number) => void
  onRemove?: (fileId: number) => void
  onViewResults?: (fileId: number) => void
  onRetry?: (fileId: number) => void
}

export function UploadProgress({ 
  upload, 
  onCancel, 
  onRemove, 
  onViewResults, 
  onRetry 
}: UploadProgressProps) {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'uploading': return '📤'
      case 'processing': return '⚙️'
      case 'completed': return '✅'
      case 'failed': return '❌'
      case 'cancelled': return '⏹️'
      default: return '❓'
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'uploading': return 'border-blue-200 bg-blue-50'
      case 'processing': return 'border-yellow-200 bg-yellow-50'
      case 'completed': return 'border-green-200 bg-green-50'
      case 'failed': return 'border-red-200 bg-red-50'
      case 'cancelled': return 'border-gray-200 bg-gray-50'
      default: return 'border-gray-200 bg-gray-50'
    }
  }

  const getProgressColor = (status: string) => {
    switch (status) {
      case 'uploading': return 'bg-blue-600'
      case 'processing': return 'bg-yellow-600'
      case 'completed': return 'bg-green-600'
      case 'failed': return 'bg-red-600'
      case 'cancelled': return 'bg-gray-600'
      default: return 'bg-gray-600'
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatSpeed = (bytesPerSecond: number) => {
    return formatFileSize(bytesPerSecond) + '/s'
  }

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${Math.round(seconds)}s`
    if (seconds < 3600) return `${Math.round(seconds / 60)}m ${Math.round(seconds % 60)}s`
    return `${Math.round(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`
  }

  return (
    <div className={`border rounded-lg p-4 ${getStatusColor(upload.status)}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{getStatusIcon(upload.status)}</span>
          <div className="min-w-0 flex-1">
            <h5 className="font-medium text-gray-900 truncate">
              {upload.filename}
            </h5>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant={
                upload.status === 'completed' ? 'success' :
                upload.status === 'failed' ? 'error' :
                upload.status === 'cancelled' ? 'secondary' :
                'info'
              }>
                {upload.status.charAt(0).toUpperCase() + upload.status.slice(1)}
              </Badge>
              {upload.details?.processingStage && (
                <Badge variant="secondary" className="text-xs">
                  {upload.details.processingStage}
                </Badge>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex gap-2">
          {upload.status === 'uploading' || upload.status === 'processing' ? (
            onCancel && (
              <Button
                variant="outline"
                onClick={() => onCancel(upload.fileId)}
                className="text-red-600 hover:text-red-700 hover:bg-red-50 text-sm px-3 py-1"
              >
                Cancel
              </Button>
            )
          ) : upload.status === 'completed' ? (
            <>
              {onViewResults && (
                <Button
                  onClick={() => onViewResults(upload.fileId)}
                  className="bg-green-600 hover:bg-green-700 text-white text-sm px-3 py-1"
                >
                  View Results
                </Button>
              )}
              {onRemove && (
                <Button
                  variant="outline"
                  onClick={() => onRemove(upload.fileId)}
                  className="text-gray-600 hover:text-gray-700 text-sm px-3 py-1"
                >
                  Remove
                </Button>
              )}
            </>
          ) : upload.status === 'failed' ? (
            <>
              {onRetry && (
                <Button
                  variant="outline"
                  onClick={() => onRetry(upload.fileId)}
                  className="text-blue-600 hover:text-blue-700 text-sm px-3 py-1"
                >
                  Retry
                </Button>
              )}
              {onRemove && (
                <Button
                  variant="outline"
                  onClick={() => onRemove(upload.fileId)}
                  className="text-gray-600 hover:text-gray-700 text-sm px-3 py-1"
                >
                  Remove
                </Button>
              )}
            </>
          ) : upload.status === 'cancelled' && onRemove && (
            <Button
              variant="outline"
              onClick={() => onRemove(upload.fileId)}
              className="text-gray-600 hover:text-gray-700 text-sm px-3 py-1"
            >
              Remove
            </Button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-3">
        <div className="flex justify-between text-sm text-gray-600 mb-1">
          <span>Progress</span>
          <span>{Math.round(upload.progress)}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all duration-300 ${getProgressColor(upload.status)}`}
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
              <span>{formatSpeed(upload.uploadSpeed)}</span>
            </div>
          )}
          {upload.estimatedTime && (
            <div className="flex justify-between">
              <span>Estimated Time:</span>
              <span>{formatTime(upload.estimatedTime)}</span>
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

      {/* Error Display */}
      {upload.error && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md">
          <div className="text-sm text-red-600">
            <strong>Error:</strong> {upload.error}
          </div>
        </div>
      )}

      {/* Success Message */}
      {upload.status === 'completed' && upload.totalRows && (
        <div className="text-sm text-green-800">
          {upload.totalRows.toLocaleString()} rows processed successfully!
        </div>
      )}

      {/* Loading Spinner */}
      {(upload.status === 'uploading' || upload.status === 'processing') && (
        <div className="flex items-center justify-center mt-3">
          <Spinner size={16} />
          <span className="ml-2 text-sm text-gray-600">
            {upload.status === 'uploading' ? 'Uploading...' : 'Processing...'}
          </span>
        </div>
      )}
    </div>
  )
}
