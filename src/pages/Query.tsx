import { useEffect, useState, useCallback, useMemo } from 'react'
import { Card, CardContent, CardHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Spinner } from '../components/ui/Spinner'
import { SearchResults } from '../components/SearchResults'
import { QueryResults } from '../components/QueryResults'
import { 
  queryDataset, 
  searchPartNumber, 
  searchPartNumberBulk, 
  searchPartNumberBulkUpload, 
  testSearchEndpoint 
} from '../lib/api'
import { useSearchParams } from 'react-router-dom'
import { useToast } from '../hooks/useToast'

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
    secondary_buyer?: string
    secondary_buyer_contact?: string
    secondary_buyer_email?: string
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

  // --- State ---
  const [fileId, setFileId] = useState<number>(0)
  const [q, setQ] = useState('count rows')
  const [res, setRes] = useState<Record<string, unknown>>()
  const [bulkInput, setBulkInput] = useState('')
  const [bulkResults, setBulkResults] = useState<Record<string, PartSearchResult> | null>(null)
  const [bulkUploading, setBulkUploading] = useState(false)
  const [activeTab, setActiveTab] = useState<'query' | 'part'>('query')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [debugInfo, setDebugInfo] = useState<string>('')
  const [pageSize, setPageSize] = useState(50)
  const [showAll, setShowAll] = useState(false)
  const [searchMode, setSearchMode] = useState<'exact' | 'fuzzy' | 'hybrid'>('hybrid')
  const [selectedPart, setSelectedPart] = useState<string>('')
  const [selectedPage, setSelectedPage] = useState(1)
  const [partNumber, setPartNumber] = useState('')

  const [params] = useSearchParams()
  const { showToast } = useToast()

  // --- Effects ---
  useEffect(() => {
    const id = parseInt(params.get('fileId') || '0')
    if (id) setFileId(id)
  }, [params])

  // --- Memoized values ---
  const selectedSource = useMemo(
    () => (selectedPart && bulkResults ? bulkResults[selectedPart] : undefined),
    [selectedPart, bulkResults]
  )

  const selectedPaged = useMemo(() => {
    if (!selectedSource) return undefined
    const companiesSrc = Array.isArray(selectedSource.companies) ? selectedSource.companies : []
    const total = selectedSource.total_matches || companiesSrc.length
    const size = showAll ? total : pageSize
    const start = showAll ? 0 : (selectedPage - 1) * pageSize
    const end = showAll ? total : start + size
    const slice = companiesSrc.slice(start, end)
    return {
      ...selectedSource,
      companies: slice,
      page: selectedPage,
      page_size: size,
      total_pages: showAll ? 1 : Math.max(1, Math.ceil(total / pageSize))
    } as PartSearchResult
  }, [selectedSource, selectedPart, selectedPage, pageSize, showAll])

  // --- Handlers ---
  const ask = useCallback(async () => {
    if (!fileId) return setError('Please enter a file ID')
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
    if (!fileId) return setError('Please enter a file ID')
    if (!partNumber) return setError('Please enter a part number')
    setLoading(true)
    setError(undefined)
    try {
      const r = await searchPartNumber(fileId, partNumber, 1, pageSize, showAll, searchMode)
      setBulkResults({ [partNumber]: r as unknown as PartSearchResult })
      setSelectedPart(partNumber)
      setSelectedPage(1)
      showToast(`Found ${r.total_matches} matches for ${partNumber}`, 'success')
    } catch (err: unknown) {
      const errorMsg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Search failed'
      setError(errorMsg)
      showToast(errorMsg, 'error')
    } finally {
      setLoading(false)
    }
  }, [fileId, partNumber, pageSize, showAll, searchMode, showToast])

  const runBulkTextSearch = useCallback(async () => {
    if (!fileId) return setError('Please enter a file ID')
    const parts = bulkInput.split(/[\n,]/g).map(s => s.trim()).filter(s => s.length >= 2).slice(0, 10000)
    if (parts.length === 0) return setError('Enter at least one part number (min 2 characters)')
    setLoading(true)
    setError(undefined)
    try {
      const r = await searchPartNumberBulk(fileId, parts, 1, pageSize, showAll, searchMode)
      setBulkResults(r.results as unknown as Record<string, PartSearchResult>)
      const first = Object.keys(r.results || {})[0]
      if (first) {
        setSelectedPart(first)
        setSelectedPage(1)
      }
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
    if (!fileId) return setError('Please enter a file ID')
    setBulkUploading(true)
    setError(undefined)
    try {
      const r = await searchPartNumberBulkUpload(fileId, f)
      setBulkResults(r.results as unknown as Record<string, PartSearchResult>)
      const first = Object.keys(r.results || {})[0]
      if (first) {
        setSelectedPart(first)
        setSelectedPage(1)
      }
      showToast(`Searched ${r.total_parts} part numbers from file`, 'success')
    } catch (err: unknown) {
      const errorMsg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Bulk upload failed'
      setError(errorMsg)
      showToast(errorMsg, 'error')
    } finally {
      setBulkUploading(false)
    }
  }, [fileId, showToast])

  async function testSearch() {
    if (!fileId) return setError('Please enter a file ID')
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

  function exportCompaniesToCSV(rows: Record<string, unknown>[], filename = 'part_search_export.csv') {
    if (!Array.isArray(rows) || rows.length === 0) return
    const headers = ['company_name','contact_details','email','quantity','unit_price','uqc','part_number','item_description','secondary_buyer','secondary_buyer_contact','secondary_buyer_email']
    const escape = (val: unknown) => {
      if (val == null) return ''
      const s = String(val)
      if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
      return s
    }
    const lines = [headers.join(',')]
    for (const row of rows) {
      lines.push(headers.map(h => escape(row[h])).join(','))
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

  // --- JSX ---
  return (
    <div className="space-y-6">
      {/* --- Tabs & Error --- */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Query Dataset</h1>
        <div className="flex gap-2">
          <Button variant={activeTab==='query'?'primary':'secondary'} onClick={()=>setActiveTab('query')} disabled={loading}>Natural Language Query</Button>
          <Button variant={activeTab==='part'?'primary':'secondary'} onClick={()=>setActiveTab('part')} disabled={loading}>Part Number Search</Button>
        </div>
      </div>
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-md"><div className="text-sm text-red-600">{error}</div></div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-4">
          {activeTab==='query' ? (
            <>
              <Card>
                <CardHeader title="Natural Language Query" description="Ask questions about your data in plain English"/>
                <CardContent>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input type="number" className="w-full sm:w-28" placeholder="file id" value={fileId || ''} onChange={e=>setFileId(parseInt(e.target.value||'0'))} disabled={loading}/>
                    <Input className="flex-1" placeholder="Ask about your data..." value={q} onChange={e=>setQ(e.target.value)} disabled={loading}/>
                    <Button onClick={ask} disabled={loading}>{loading?<Spinner size={16}/>:'Send'}</Button>
                  </div>
                </CardContent>
              </Card>
              <QueryResults results={res} loading={loading} onCopyAnswer={()=>res?.answer && (navigator.clipboard.writeText(res.answer), showToast('Answer copied!','success'))} onCopySQL={()=>{
                const sqlQuery = (res as any)?.sql?.query || ''
                if(sqlQuery) navigator.clipboard.writeText(sqlQuery), showToast('SQL copied!','success')
              }}/>
            </>
          ) : (
            <>
              {/* --- Part Search UI --- */}
              <Card>
                <CardHeader title="Part Number Search" description="Find companies that have a specific part number or run bulk searches"/>
                <CardContent>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input type="number" className="w-full sm:w-28" placeholder="file id" value={fileId || ''} onChange={e=>setFileId(parseInt(e.target.value||'0'))} disabled={loading}/>
                    <Input className="flex-1" placeholder="Enter part number..." value={partNumber} onChange={e=>setPartNumber(e.target.value)} disabled={loading}/>
                    <Button onClick={searchPart} disabled={loading}>{loading?<Spinner size={16}/>:'Search'}</Button>
                    <Button variant="secondary" onClick={testSearch} disabled={loading}>{loading?<Spinner size={16}/>:'Debug'}</Button>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-3">
                    <div className="flex items-center gap-3">
                      <label className="text-sm font-medium">Search mode</label>
                      <select className="border rounded px-2 py-1 text-sm" value={searchMode} onChange={e=>setSearchMode(e.target.value as any)} disabled={loading}>
                        <option value="exact">Exact</option>
                        <option value="fuzzy">Fuzzy</option>
                        <option value="hybrid">Hybrid</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Part numbers (comma or newline separated)</label>
                      <textarea className="mt-1 w-full border rounded p-2 min-h-[100px]" placeholder="e.g. PN123, PN456" value={bulkInput} onChange={e=>setBulkInput(e.target.value)} disabled={loading}/>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <Button onClick={runBulkTextSearch} disabled={loading}>{loading?<Spinner size={16}/>:'Run Search'}</Button>
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input type="file" accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel" onChange={e=>e.target.files?.[0] && runBulkUpload(e.target.files[0])} disabled={bulkUploading}/>
                        </label>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              {/* --- Bulk Results --- */}
              {bulkResults && (
                <Card>
                  <CardHeader title="Bulk Results" description="Grouped by part number"/>
                  <CardContent>
                    <div className="space-y-4">
                      {Object.keys(bulkResults).map(pn=>{
                        const r = bulkResults[pn]
                        return (
                          <div key={pn} className={`p-3 border rounded ${selectedPart===pn?'bg-blue-50 border-blue-200':''}`}>
                            <div className="flex items-center justify-between">
                              <div className="font-medium">{pn} — {r?.total_matches||0} matches <span className="text-xs text-gray-500">[{r?.search_mode||'hybrid'}:{r?.match_type||'n/a'}]</span></div>
                              <div className="flex gap-2">
                                <Button variant="secondary" onClick={()=>{setSelectedPart(pn); setSelectedPage(1)}}>View details</Button>
                                <Button variant="secondary" onClick={()=>exportCompaniesToCSV(r?.companies||[],`part_${pn}.csv`)}>Export CSV</Button>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}
              {/* --- Selected Part Results --- */}
              {selectedPart && selectedPaged && (
                <SearchResults
                  results={selectedPaged as any}
                  loading={loading}
                  onExportCSV={()=>exportCompaniesToCSV(selectedPaged.companies as any,`part_search_${selectedPart}.csv`)}
                  onPageChange={async (page:number)=>{
                    setSelectedPage(page)
                    if(fileId && selectedPart) {
                      const r = await searchPartNumber(fileId, selectedPart, page, pageSize, showAll, searchMode)
                      setBulkResults(prev=>prev?{...prev,[selectedPart]:r as any}:prev)
                    }
                  }}
                  onPageSizeChange={async size=>{
                    setPageSize(size)
                    setSelectedPage(1)
                    if(fileId && selectedPart) {
                      const r = await searchPartNumber(fileId, selectedPart, 1, size, showAll, searchMode)
                      setBulkResults(prev=>prev?{...prev,[selectedPart]:r as any}:prev)
                    }
                  }}
                  onShowAllChange={async all=>{
                    setShowAll(all)
                    setSelectedPage(1)
                    if(fileId && selectedPart) {
                      const r = await searchPartNumber(fileId, selectedPart, 1, pageSize, all, searchMode)
                      setBulkResults(prev=>prev?{...prev,[selectedPart]:r as any}:prev)
                    }
                  }}
                  currentPage={selectedPage}
                  pageSize={pageSize}
                  showAll={showAll}
                />
              )}
            </>
          )}
        </div>
        {debugInfo && (
          <Card>
            <CardHeader title="Debug Information"/>
            <CardContent>
              <pre className="text-xs bg-gray-100 p-3 rounded overflow-auto max-h-64">{debugInfo}</pre>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
