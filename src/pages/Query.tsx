import { useEffect, useState, useCallback, useRef } from 'react'
import { Card, CardContent, CardHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Spinner } from '../components/ui/Spinner'
import { SearchResults } from '../components/SearchResults'
import { QueryResults } from '../components/QueryResults'
import { queryDataset, searchPartNumber, searchPartNumberBulk, searchPartNumberBulkUpload, testSearchEndpoint } from '../lib/api'
import { useSearchParams } from 'react-router-dom'
import { useToast } from '../hooks/useToast'
// removed auto-search debounce

export default function QueryPage() {
  type Company = {
    company_name: string
    contact_details: string
    email: string
    quantity: number | string
    unit_price: number | string
    uqc: string
    item_description: string
    part_number?: string
  }
  type PartSearchResult = {
    companies: Company[]
    total_matches: number
    part_number: string
    message?: string
    latency_ms?: number
    cached?: boolean
    price_summary?: {
      min_price: number
      max_price: number
      total_quantity: number
      avg_price?: number
    }
    page?: number
    page_size?: number
    total_pages?: number
    search_mode?: string
    match_type?: string
    error?: string
  }
  const [fileId, setFileId] = useState<number>(0)
  const [q, setQ] = useState('count rows')
  const [res, setRes] = useState<Record<string, unknown>>()
  const [partNumber, setPartNumber] = useState('')
  const [bulkInput, setBulkInput] = useState('')
  const [bulkResults, setBulkResults] = useState<Record<string, PartSearchResult> | null>(null)
  const [bulkUploading, setBulkUploading] = useState(false)
  const [partResults, setPartResults] = useState<PartSearchResult | undefined>()
  const [partPage, setPartPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [showAll, setShowAll] = useState(false)
  const [searchMode, setSearchMode] = useState<'exact' | 'fuzzy' | 'hybrid'>('hybrid')
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function exportCompaniesToCSV(rows: Record<string, unknown>[], filename = 'part_search_export.csv') {
    if (!Array.isArray(rows) || rows.length === 0) return
    const headers = [
      'company_name',
      'contact_details',
      'email',
      'quantity',
      'unit_price',
      'uqc',
      'part_number',
      'item_description',
      'secondary_buyer'
    ]
    const escape = (val: unknown) => {
      if (val === null || val === undefined) return ''
      const s = String(val)
      if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
      return s
    }
    const lines = [headers.join(',')]
    for (const row of rows) {
      const line = headers.map(h => escape(row[h])).join(',')
      lines.push(line)
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }
  const [activeTab, setActiveTab] = useState<'query' | 'part'>('query')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [debugInfo, setDebugInfo] = useState<string>('')
  const [params] = useSearchParams()
  const { showToast } = useToast()
  
  // Drag and drop handlers
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true)
    } else if (e.type === "dragleave") {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0]
      if (droppedFile.name.toLowerCase().match(/\.(xlsx|xls|csv)$/)) {
        runBulkUpload(droppedFile)
        setError(undefined)
      } else {
        setError('Please upload an Excel (.xlsx, .xls) or CSV file')
      }
    }
  }, [fileId, showToast])
  
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
      const r = await searchPartNumber(fileId, partNumber.trim(), 1, pageSize, showAll, searchMode)
      setPartResults(r as unknown as PartSearchResult)
      setPartPage(1)
      showToast(`Found ${(r as { total_matches: number }).total_matches} companies with part number "${partNumber}"`, 'success')
    } catch (err: unknown) {
      const errorMsg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Search failed'
      setError(errorMsg)
      showToast(errorMsg, 'error')
    } finally {
      setLoading(false)
    }
  }, [fileId, partNumber, pageSize, showAll, searchMode, showToast])

  const runBulkTextSearch = useCallback(async () => {
    if (!fileId) {
      setError('Please enter a file ID')
      return
    }
    const parts = bulkInput
      .split(/[\n,]/g)
      .map(s => s.trim())
      .filter(s => s.length >= 2)
      .slice(0, 10000)
    if (parts.length === 0) {
      setError('Enter at least one part number (min 2 characters)')
      return
    }
    setLoading(true)
    setError(undefined)
    try {
      const r = await searchPartNumberBulk(fileId, parts, 1, pageSize, showAll, searchMode)
      setBulkResults(r.results as unknown as Record<string, PartSearchResult>)
      showToast(`Searched ${r.total_parts} part numbers`, 'success')
    } catch (err: unknown) {
      const errorMsg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Bulk search failed'
      setError(errorMsg)
      showToast(errorMsg, 'error')
    } finally {
      setLoading(false)
    }
  }, [fileId, bulkInput, pageSize, showAll, searchMode, showToast])

  const runBulkUpload = useCallback(async (f: File) => {
    if (!fileId) {
      setError('Please enter a file ID')
      return
    }
    setBulkUploading(true)
    setError(undefined)
    try {
      const r = await searchPartNumberBulkUpload(fileId, f)
      setBulkResults(r.results as unknown as Record<string, PartSearchResult>)
      showToast(`Searched ${r.total_parts} part numbers from file`, 'success')
    } catch (err: unknown) {
      const errorMsg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Bulk upload failed'
      setError(errorMsg)
      showToast(errorMsg, 'error')
    } finally {
      setBulkUploading(false)
    }
  }, [fileId, showToast])

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
              <QueryResults 
                results={res as {
                  answer?: string
                  route?: string
                  confidence?: number
                  latency_ms?: number
                  cached?: boolean
                  sql?: { query?: string }
                  semantic?: Array<{ id?: string; text?: string; score?: number }>
                } | undefined}
                loading={loading}
                onCopyAnswer={() => {
                  if (res?.answer) {
                    navigator.clipboard.writeText(res.answer as string)
                    showToast('Answer copied to clipboard!', 'success')
                  }
                }}
                onCopySQL={() => {
                  const sqlQuery = (res && typeof (res as Record<string, unknown>).sql === 'object' && (res as { sql?: { query?: string } }).sql?.query) || ''
                  if (sqlQuery) {
                    navigator.clipboard.writeText(sqlQuery)
                    showToast('SQL query copied to clipboard!', 'success')
                  }
                }}
              />
            </>
          ) : (
            <>
              <Card>
                <CardHeader title="Part Number Search" description="Find companies that have a specific part number or run bulk searches" />
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
                  <div className="mt-4 grid grid-cols-1 gap-3">
                    <div className="flex items-center gap-3">
                      <label className="text-sm font-medium">Search mode</label>
                      <select
                        className="border rounded px-2 py-1 text-sm"
                        value={searchMode}
                        onChange={e => setSearchMode(e.target.value as 'exact' | 'fuzzy' | 'hybrid')}
                        disabled={loading}
                      >
                        <option value="exact">Exact</option>
                        <option value="fuzzy">Fuzzy</option>
                        <option value="hybrid">Hybrid</option>
                      </select>
                      <div className="text-xs text-gray-500">
                        Try variations like {partNumber ? `${partNumber.replace(/[-/~.,%*&]/g, '')}, ${partNumber.replace(/[^A-Za-z0-9]/g, '-').replace(/-+/g, '-')}, ${partNumber.replace(/[^A-Za-z0-9]/g, '/').replace(/\/+/g, '/')}` : 'ABC123, ABC-123, ABC/123'}
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Bulk part numbers (comma or newline separated)</label>
                      <textarea 
                        className="mt-1 w-full border rounded p-2 min-h-[100px]"
                        placeholder={"e.g. PN123, PN456,\nPN789"}
                        value={bulkInput}
                        onChange={e => setBulkInput(e.target.value)}
                        disabled={loading}
                      />
                      <div className="flex gap-2 mt-2">
                        <Button onClick={runBulkTextSearch} disabled={loading}>
                          {loading ? <Spinner size={16} /> : 'Run Bulk Search'}
                        </Button>
                        <Button 
                          variant="secondary" 
                          onClick={() => fileInputRef.current?.click()}
                          disabled={bulkUploading}
                        >
                          {bulkUploading ? <Spinner size={16} /> : '📁 Upload File'}
                        </Button>
                        <input 
                          ref={fileInputRef}
                          type="file" 
                          accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                          onChange={e => {
                            const f = e.target.files?.[0]
                            if (f) runBulkUpload(f)
                          }}
                          disabled={bulkUploading}
                          className="hidden"
                        />
                      </div>
                      
                      {/* Drag and Drop Zone */}
                      <div 
                        className={`mt-4 border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                          dragActive 
                            ? 'border-blue-400 bg-blue-50' 
                            : 'border-gray-300 hover:border-gray-400'
                        }`}
                        onDragEnter={handleDrag}
                        onDragLeave={handleDrag}
                        onDragOver={handleDrag}
                        onDrop={handleDrop}
                      >
                        <div className="text-gray-500">
                          <div className="text-lg mb-2">📁</div>
                          <p className="text-sm">
                            Drag and drop an Excel or CSV file here, or click "Upload File" above
                          </p>
                          <p className="text-xs mt-1 text-gray-400">
                            Supports .xlsx, .xls, and .csv files
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              {!bulkResults && (
                <SearchResults
                results={partResults as unknown as {
                  companies: Company[]
                  total_matches: number
                  part_number: string
                  message: string
                  latency_ms?: number
                  cached?: boolean
                  price_summary?: { min_price: number; max_price: number; total_quantity: number; avg_price: number }
                } | undefined}
                loading={loading}
                onExportCSV={() => exportCompaniesToCSV(
                  ((partResults as Record<string, unknown>)?.companies as Record<string, unknown>[]) || [], 
                  `part_search_${(partResults as Record<string, unknown>)?.part_number || 'export'}.csv`
                )}
                onPageChange={async (page: number) => {
                  setPartPage(page)
                  try {
                    const r = await searchPartNumber(fileId, partNumber.trim(), page, pageSize, showAll, searchMode)
                    setPartResults(r as unknown as PartSearchResult)
                  } catch (error) {
                    console.error('Page change error:', error)
                  }
                }}
                onPageSizeChange={async (size: number) => {
                  setPageSize(size)
                  setPartPage(1)
                  try {
                    const r = await searchPartNumber(fileId, partNumber.trim(), 1, size, showAll, searchMode)
                    setPartResults(r as unknown as PartSearchResult)
                  } catch (error) {
                    console.error('Page size change error:', error)
                  }
                }}
                onShowAllChange={async (showAll: boolean) => {
                  setShowAll(showAll)
                  setPartPage(1)
                  try {
                    const r = await searchPartNumber(fileId, partNumber.trim(), 1, pageSize, showAll, searchMode)
                    setPartResults(r as unknown as PartSearchResult)
                  } catch (error) {
                    console.error('Show all change error:', error)
                  }
                }}
                currentPage={partPage}
                pageSize={pageSize}
                showAll={showAll}
              />
              )}

              {bulkResults && (
                <Card>
                  <CardHeader 
                    title="Bulk Results" 
                    description={`Grouped by part number - ${Object.keys(bulkResults).length} parts searched`}
                  />
                  <CardContent>
                    <div className="mb-4 flex justify-between items-center">
                      <div className="text-sm text-gray-600">
                        Found results for {Object.values(bulkResults).filter(r => r && !r.error && r.total_matches > 0).length} out of {Object.keys(bulkResults).length} parts
                      </div>
                      <Button 
                        variant="secondary" 
                        onClick={() => setBulkResults(null)}
                        className="text-sm"
                      >
                        Clear Results
                      </Button>
                    </div>
                    <div className="space-y-4">
                      {Object.keys(bulkResults).map((pn) => {
                        const r = bulkResults[pn]
                        if (!r || r.error) {
                          return (
                            <div key={pn} className="p-3 border rounded">
                              <div className="font-medium">{pn}</div>
                              <div className="text-red-600 text-sm">{r.error || 'No results'}</div>
                            </div>
                          )
                        }
                        return (
                          <div key={pn} className="p-3 border rounded">
                            <div className="flex items-center justify-between">
                              <div className="font-medium">{pn} — {r.total_matches} matches <span className="text-xs text-gray-500">[{r.search_mode || 'hybrid'}:{r.match_type || 'n/a'}]</span></div>
                              <Button 
                                variant="secondary"
                                onClick={() => exportCompaniesToCSV(r.companies || [], `part_${pn}.csv`)}
                              >Export CSV</Button>
                            </div>
                            <div className="mt-2 overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="text-left border-b">
                                    <th className="py-1 pr-2">Company</th>
                                    <th className="py-1 pr-2">Contact</th>
                                    <th className="py-1 pr-2">Email</th>
                                    <th className="py-1 pr-2">Qty</th>
                                    <th className="py-1 pr-2">Unit Price</th>
                                    <th className="py-1 pr-2">UQC</th>
                                    <th className="py-1 pr-2">Part</th>
                                    <th className="py-1 pr-2">Description</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(r.companies || []).slice(0, 100).map((c: Company, idx) => (
                                    <tr key={idx} className="border-b last:border-0">
                                      <td className="py-1 pr-2">{c.company_name}</td>
                                      <td className="py-1 pr-2">{c.contact_details}</td>
                                      <td className="py-1 pr-2">{c.email}</td>
                                      <td className="py-1 pr-2">{c.quantity}</td>
                                      <td className="py-1 pr-2">{c.unit_price}</td>
                                      <td className="py-1 pr-2">{c.uqc}</td>
                                      <td className="py-1 pr-2">{c.part_number}</td>
                                      <td className="py-1 pr-2">{c.item_description}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}
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
      </div>
    </div>
  )
}


