import { Card, CardContent, CardHeader } from './ui/Card'
import { Badge } from './ui/Badge'

interface UploadAnalyticsProps {
  uploads: Map<number, any>
  activeUploads: number[]
  completedUploads: number[]
  failedUploads: number[]
}

export function UploadAnalytics({ 
  uploads, 
  activeUploads, 
  completedUploads, 
  failedUploads 
}: UploadAnalyticsProps) {
  const totalUploads = uploads.size
  const activeCount = activeUploads.length
  const completedCount = completedUploads.length
  const failedCount = failedUploads.length

  // Calculate total data processed
  const totalDataProcessed = Array.from(uploads.values())
    .filter(upload => upload.status === 'completed')
    .reduce((total, upload) => total + (upload.totalRows || 0), 0)

  // Calculate average processing time (mock data for now)
  const avgProcessingTime = completedCount > 0 ? '2.5 min' : '0 min'

  // Calculate success rate
  const successRate = totalUploads > 0 ? (completedCount / totalUploads) * 100 : 0

  // Get recent activity
  const recentUploads = Array.from(uploads.values())
    .sort((a, b) => b.fileId - a.fileId)
    .slice(0, 5)

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


  return (
    <div className="space-y-4">
      {/* Summary Stats */}
      <Card>
        <CardHeader title="Upload Analytics" description="Overview of your upload activity" />
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-4 bg-blue-50 rounded-lg">
              <div className="text-2xl font-bold text-blue-600">{totalUploads}</div>
              <div className="text-sm text-gray-600">Total Uploads</div>
            </div>
            
            <div className="text-center p-4 bg-green-50 rounded-lg">
              <div className="text-2xl font-bold text-green-600">{completedCount}</div>
              <div className="text-sm text-gray-600">Completed</div>
            </div>
            
            <div className="text-center p-4 bg-yellow-50 rounded-lg">
              <div className="text-2xl font-bold text-yellow-600">{activeCount}</div>
              <div className="text-sm text-gray-600">Active</div>
            </div>
            
            <div className="text-center p-4 bg-red-50 rounded-lg">
              <div className="text-2xl font-bold text-red-600">{failedCount}</div>
              <div className="text-sm text-gray-600">Failed</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Performance Metrics */}
      <Card>
        <CardHeader title="Performance Metrics" description="Upload and processing statistics" />
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <div className="text-2xl font-bold text-gray-900">
                {totalDataProcessed.toLocaleString()}
              </div>
              <div className="text-sm text-gray-600">Rows Processed</div>
            </div>
            
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <div className="text-2xl font-bold text-gray-900">{avgProcessingTime}</div>
              <div className="text-sm text-gray-600">Avg Processing Time</div>
            </div>
            
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <div className="text-2xl font-bold text-gray-900">
                {Math.round(successRate)}%
              </div>
              <div className="text-sm text-gray-600">Success Rate</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card>
        <CardHeader title="Recent Activity" description="Latest upload activity" />
        <CardContent>
          {recentUploads.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No uploads yet
            </div>
          ) : (
            <div className="space-y-3">
              {recentUploads.map((upload) => (
                <div key={upload.fileId} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{getStatusIcon(upload.status)}</span>
                    <div>
                      <div className="font-medium text-gray-900 truncate max-w-xs">
                        {upload.filename}
                      </div>
                      <div className="text-sm text-gray-500">
                        {upload.totalRows ? `${upload.totalRows.toLocaleString()} rows` : 'Processing...'}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Badge variant={
                      upload.status === 'completed' ? 'success' :
                      upload.status === 'failed' ? 'error' :
                      upload.status === 'cancelled' ? 'secondary' :
                      'info'
                    }>
                      {upload.status}
                    </Badge>
                    {upload.progress > 0 && upload.status !== 'completed' && (
                      <div className="text-sm text-gray-600">
                        {Math.round(upload.progress)}%
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
