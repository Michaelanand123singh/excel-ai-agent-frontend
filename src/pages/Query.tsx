import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Spinner } from '../components/ui/Spinner'
import { queryDataset, searchPartNumber, testSearchEndpoint } from '../lib/api'
import { useSearchParams } from 'react-router-dom'
import { useToast } from '../hooks/useToast'
// removed auto-search debounce

export default function QueryPage() {
  const [fileId, setFileId] = useState<number>(0)
  const [q, setQ] = useState('count rows')
  const [res, setRes] = useState<Record<string, unknown>>()
  const [partNumber, setPartNumber] = useState('')
  const [partResults, setPartResults] = useState<Record<string, unknown>>()
  const [activeTab, setActiveTab] = useState<'query' | 'part'>('query')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [debugInfo, setDebugInfo] = useState<string>('')
  const [params] = useSearchParams()
  const { showToast } = useToast()
  
  // Manual search only; no debounce auto-trigger
  
  useEffect(()=>{
    const id = parseInt(params.get('fileId') || '0')
    if (id) setFileId(id)
  },[params])

  const ask = useCallback(async () => {
    if (!fileId) {
      setError('Please enter a file ID')
      return
    }
    setLoading(true)
    setError(undefined)
    try {
      const r = await queryDataset(fileId, q)
      setRes(r)
      showToast('Query executed successfully!', 'success')
    } catch (err: unknown) {
      const errorMsg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Query failed'
      setError(errorMsg)
      showToast(errorMsg, 'error')
    } finally {
      setLoading(false)
    }
  }, [fileId, q, showToast])

  const searchPart = useCallback(async () => {
    if (!fileId) {
      setError('Please enter a file ID')
      return
    }
    if (!partNumber.trim()) {
      setError('Please enter a part number')
      return
    }
    setLoading(true)
    setError(undefined)
    try {
      const r = await searchPartNumber(fileId, partNumber.trim())
      setPartResults(r)
      showToast(`Found ${(r as { total_matches: number }).total_matches} companies with part number "${partNumber}"`, 'success')
    } catch (err: unknown) {
      const errorMsg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Search failed'
      setError(errorMsg)
      showToast(errorMsg, 'error')
    } finally {
      setLoading(false)
    }
  }, [fileId, partNumber, showToast])

  // No refs needed in manual mode

  // No auto-search effects; users must click buttons

  async function testSearch() {
    if (!fileId) {
      setError('Please enter a file ID')
      return
    }
    setLoading(true)
    setError(undefined)
    try {
      const result = await testSearchEndpoint(fileId)
      setDebugInfo(JSON.stringify(result, null, 2))
      showToast('Debug info retrieved successfully!', 'success')
    } catch (err: unknown) {
      const errorMsg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Debug test failed'
      setError(errorMsg)
      showToast(errorMsg, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Query Dataset</h1>
        <div className="flex gap-2">
          <Button 
            variant={activeTab === 'query' ? 'primary' : 'secondary'} 
            onClick={() => setActiveTab('query')}
            disabled={loading}
          >
            Natural Language Query
          </Button>
          <Button 
            variant={activeTab === 'part' ? 'primary' : 'secondary'} 
            onClick={() => setActiveTab('part')}
            disabled={loading}
          >
            Part Number Search
          </Button>
        </div>
      </div>
      

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md">
          <div className="text-sm text-red-600">{error}</div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-4">
          {activeTab === 'query' ? (
            <>
              <Card>
                <CardHeader title="Natural Language Query" description="Ask questions about your data in plain English" />
                <CardContent>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input 
                      type="number" 
                      className="w-full sm:w-28" 
                      placeholder="file id" 
                      value={fileId || ''} 
                      onChange={e => setFileId(parseInt(e.target.value || '0'))}
                      disabled={loading}
                    />
                        <Input 
                          className="flex-1" 
                          placeholder="Ask about your data..." 
                          value={q} 
                          onChange={e => setQ(e.target.value)}
                          disabled={loading}
                        />
                    <Button onClick={ask} disabled={loading}>
                      {loading ? <Spinner size={16} /> : 'Send'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader title="Answer" />
                <CardContent>
                      <div className="text-sm text-gray-600">Answer</div>
                      <div className="mt-2 text-sm">{(res as { answer?: string })?.answer || '-'}</div>
                      {res && (
                        <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
                          <span>Route: {(res as { route?: string }).route}</span>
                          <span>Confidence: {Math.round(((res as { confidence?: number }).confidence || 0) * 100)}%</span>
                          <span className={`font-medium ${((res as { latency_ms?: number }).latency_ms || 0) < 1000 ? 'text-green-600' : 'text-yellow-600'}`}>
                            ⚡ {(res as { latency_ms?: number }).latency_ms || 0}ms
                          </span>
                          {(res as { cached?: boolean }).cached && (
                            <span className="text-blue-600 font-medium">📦 Cached</span>
                          )}
                        </div>
                      )}
                </CardContent>
              </Card>
            </>
          ) : (
            <>
              <Card>
                <CardHeader title="Part Number Search" description="Find companies that have a specific part number" />
                <CardContent>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input 
                      type="number" 
                      className="w-full sm:w-28" 
                      placeholder="file id" 
                      value={fileId || ''} 
                      onChange={e => setFileId(parseInt(e.target.value || '0'))}
                      disabled={loading}
                    />
                        <Input 
                          className="flex-1" 
                          placeholder="Enter part number..." 
                          value={partNumber} 
                          onChange={e => setPartNumber(e.target.value)}
                          disabled={loading}
                        />
                        <Button onClick={searchPart} disabled={loading}>
                          {loading ? <Spinner size={16} /> : 'Search'}
                        </Button>
                        <Button variant="secondary" onClick={testSearch} disabled={loading}>
                          {loading ? <Spinner size={16} /> : 'Debug'}
                        </Button>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader title="Search Results" />
                <CardContent>
                  {partResults ? (
                        <div>
                          <div className="text-sm font-medium text-green-600 mb-2">
                            {(partResults as { message?: string }).message}
                          </div>
                          <div className="flex items-center gap-4 text-sm text-gray-600 mb-3">
                            <span>Found {(partResults as { total_matches?: number }).total_matches} companies with part number "{(partResults as { part_number?: string }).part_number}"</span>
                            <span className={`font-medium ${((partResults as { latency_ms?: number }).latency_ms || 0) < 1000 ? 'text-green-600' : 'text-yellow-600'}`}>
                              ⚡ {(partResults as { latency_ms?: number }).latency_ms || 0}ms
                            </span>
                            {(partResults as { cached?: boolean }).cached && (
                              <span className="text-blue-600 font-medium">📦 Cached</span>
                            )}
                          </div>
                      <div className="space-y-2 max-h-96 overflow-y-auto">
                        {(partResults.companies as Record<string, unknown>[]).map((company: Record<string, unknown>, i: number) => (
                          <div key={i} className="border rounded p-3 bg-gray-50">
                            <div className="text-sm font-medium">Company #{i + 1}</div>
                            <div className="text-xs text-gray-600 mt-1">
                              {Object.entries(company).map(([key, value]) => (
                                <div key={key} className="flex">
                                  <span className="font-medium w-24">{key}:</span>
                                  <span>{String(value)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-gray-500">Enter a part number to search</div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
        
        {debugInfo && (
          <Card>
            <CardHeader title="Debug Information" />
            <CardContent>
              <pre className="text-xs bg-gray-100 p-3 rounded overflow-auto max-h-64">
                {debugInfo}
              </pre>
            </CardContent>
          </Card>
        )}
        
        {activeTab === 'query' && (
          <div className="space-y-4">
            <Card>
              <CardHeader title="SQL Preview" />
              <CardContent>
                    <pre className="mt-2 text-xs bg-gray-50 p-2 rounded overflow-auto">{(res as { sql?: { query?: string } })?.sql?.query || '--'}</pre>
              </CardContent>
            </Card>
            <Card>
              <CardHeader title="Semantic Matches" />
              <CardContent>
                    <div className="mt-2 text-xs space-y-2">
                      {((res?.semantic as Record<string, unknown>[]) || []).map((s: Record<string, unknown>, i: number) => (
                        <div key={i} className="border rounded p-2">
                          <div className="font-medium">{(s as { id?: string }).id}</div>
                          <div className="text-gray-600">{(s as { text?: string }).text}</div>
                        </div>
                      ))}
                    </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}


