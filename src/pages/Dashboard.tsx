import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { useAuth } from '../store/auth'
import { useDatasets } from '../store/datasets'
import { getAnalyticsSummary } from '../lib/api'
import { useToast } from '../hooks/useToast'

export default function Dashboard() {
  const { email, logout } = useAuth()
  const { files: allFiles, loadFiles } = useDatasets()
  const [analytics, setAnalytics] = useState<{ total_queries: number; avg_latency_ms: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const { showToast } = useToast()

  useEffect(() => {
    const loadData = async () => {
      try {
        // Load both files and analytics
        await Promise.all([
          loadFiles(),
          getAnalyticsSummary().then(setAnalytics).catch(console.error)
        ])
      } catch (error) {
        console.error('Failed to load data:', error)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [loadFiles])

  const handleLogout = () => {
    logout()
    showToast('Logged out successfully', 'success')
    navigate('/login')
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Welcome back, {email || 'User'}!</h1>
          <p className="text-gray-600">Here's what's happening with your data analysis platform.</p>
        </div>
        <Button variant="secondary" onClick={handleLogout}>
          Logout
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader title="Total Queries" />
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {loading ? '...' : analytics?.total_queries || 0}
            </div>
            <p className="text-sm text-gray-500">All time queries</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Avg Response Time" />
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {loading ? '...' : `${analytics?.avg_latency_ms || 0}ms`}
            </div>
            <p className="text-sm text-gray-500">Average latency</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Recent Datasets" />
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">
              {allFiles?.length || 0}
            </div>
            <p className="text-sm text-gray-500">Uploaded files</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="System Status" />
          <CardContent>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span className="text-sm font-medium text-green-600">Online</span>
            </div>
            <p className="text-sm text-gray-500">All systems operational</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader title="Quick Actions" />
          <CardContent>
            <div className="space-y-3">
              <Button 
                onClick={() => navigate('/upload')} 
                className="w-full justify-start"
              >
                📁 Upload New Dataset
              </Button>
              <Button 
                variant="secondary" 
                onClick={() => navigate('/query')} 
                className="w-full justify-start"
              >
                🔍 Query Your Data
              </Button>
              <Button 
                variant="secondary" 
                onClick={() => navigate('/analytics')} 
                className="w-full justify-start"
              >
                📊 View Analytics
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Recent Datasets" />
          <CardContent>
            {Array.isArray(allFiles) && allFiles.length > 0 ? (
              <div className="space-y-2">
                {allFiles.slice(0, 5).map((dataset) => (
                  <div 
                    key={dataset.id}
                    className="flex items-center justify-between p-2 bg-gray-50 rounded-md cursor-pointer hover:bg-gray-100"
                    onClick={() => navigate(`/query?fileId=${dataset.id}`)}
                  >
                    <div>
                      <div className="text-sm font-medium">{dataset.filename}</div>
                      <div className="text-xs text-gray-500">ID: {dataset.id}</div>
                    </div>
                    <div className="text-xs text-gray-400">→</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-4 text-gray-500">
                <p className="text-sm">No datasets uploaded yet</p>
                <Button 
                  variant="secondary" 
                  onClick={() => navigate('/upload')}
                  className="mt-2"
                >
                  Upload Your First Dataset
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
