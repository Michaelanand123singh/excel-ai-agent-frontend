import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader } from '../components/ui/Card'
import { getAnalyticsSummary } from '../lib/api'

export default function AnalyticsPage() {
  const [data, setData] = useState<{ total_queries: number; avg_latency_ms: number }>()
  useEffect(() => { getAnalyticsSummary().then(setData).catch(()=>{}) }, [])
  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Analytics</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader title="Total Queries" />
          <CardContent>
            <div className="text-3xl font-semibold">{data?.total_queries ?? '-'}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader title="Avg Latency (ms)" />
          <CardContent>
            <div className="text-3xl font-semibold">{data?.avg_latency_ms ?? '-'}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}


