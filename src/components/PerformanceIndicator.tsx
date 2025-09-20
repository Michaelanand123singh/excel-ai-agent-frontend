import { useState } from 'react'

interface PerformanceIndicatorProps {
  latency?: number
  cached?: boolean
  className?: string
}

export function PerformanceIndicator({ latency, cached, className = '' }: PerformanceIndicatorProps) {
  const [showDetails, setShowDetails] = useState(false)

  if (!latency) return null

  const getPerformanceColor = (ms: number) => {
    if (ms < 200) return 'text-green-600'
    if (ms < 500) return 'text-yellow-600'
    if (ms < 1000) return 'text-orange-600'
    return 'text-red-600'
  }

  const getPerformanceLabel = (ms: number) => {
    if (ms < 200) return 'Excellent'
    if (ms < 500) return 'Good'
    if (ms < 1000) return 'Fair'
    return 'Slow'
  }

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <div 
        className="flex items-center gap-1 cursor-pointer hover:bg-gray-100 px-2 py-1 rounded"
        onClick={() => setShowDetails(!showDetails)}
        title="Click for performance details"
      >
        <span className={`text-sm font-medium ${getPerformanceColor(latency)}`}>
          ⚡ {latency}ms
        </span>
        {cached && (
          <span className="text-xs text-blue-600 font-medium">📦</span>
        )}
      </div>
      
      {showDetails && (
        <div className="absolute z-10 mt-8 bg-white border rounded-lg shadow-lg p-3 min-w-48">
          <div className="text-sm">
            <div className="font-medium mb-2">Performance Details</div>
            <div className="space-y-1">
              <div className="flex justify-between">
                <span>Response Time:</span>
                <span className={getPerformanceColor(latency)}>{latency}ms</span>
              </div>
              <div className="flex justify-between">
                <span>Performance:</span>
                <span className={getPerformanceColor(latency)}>{getPerformanceLabel(latency)}</span>
              </div>
              <div className="flex justify-between">
                <span>Cache Status:</span>
                <span className={cached ? 'text-green-600' : 'text-gray-600'}>
                  {cached ? 'Cached' : 'Fresh'}
                </span>
              </div>
              <div className="mt-2 pt-2 border-t text-xs text-gray-500">
                {latency < 1000 ? '✅ Under 1 second target' : '⚠️ Above 1 second target'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
