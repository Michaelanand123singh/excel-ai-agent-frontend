import { useState, useCallback, useRef } from 'react'
import { Card, CardContent, CardHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Spinner } from '../components/ui/Spinner'
import { Badge } from '../components/ui/Badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/Table'
import { useToast } from '../hooks/useToast'

interface UserPartData {
  part_number: string
  part_name: string
  quantity: number
  manufacturer_name: string
  row_index: number
}

interface SearchResult {
  match_status: string
  match_type: string
  confidence: number
  database_record: {
    company_name: string
    contact_details: string
    email: string
    available_quantity: number
    unit_price: number
    item_description: string
    part_number: string
    uqc: string
    secondary_buyer: string
  }
  price_calculation: {
    unit_price: number
    total_cost: number
    available_quantity: number
    requested_quantity: number
  }
  search_time_ms: number
}

interface BulkSearchResult {
  user_data: UserPartData
  search_result: SearchResult
  processing_errors: string[]
}

interface BulkSearchResponse {
  upload_summary: {
    total_parts: number
    found_matches: number
    partial_matches: number
    no_matches: number
    processing_time_ms: number
    parse_errors: string[]
  }
  results: BulkSearchResult[]
  file_info: {
    filename: string
    file_size_bytes: number
    search_mode: string
  }
}

export default function BulkSearchPage() {
  const [fileId, setFileId] = useState<number>(0)
  const [file, setFile] = useState<File | null>(null)
  const [searchMode, setSearchMode] = useState<'exact' | 'fuzzy' | 'hybrid'>('hybrid')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<BulkSearchResponse | null>(null)
  const [error, setError] = useState<string>()
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { showToast } = useToast()

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
        setFile(droppedFile)
        setError(undefined)
      } else {
        setError('Please upload an Excel (.xlsx, .xls) or CSV file')
      }
    }
  }, [])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0]
      if (selectedFile.name.toLowerCase().match(/\.(xlsx|xls|csv)$/)) {
        setFile(selectedFile)
        setError(undefined)
      } else {
        setError('Please upload an Excel (.xlsx, .xls) or CSV file')
      }
    }
  }, [])

  const handleSearch = useCallback(async () => {
    if (!fileId) {
      setError('Please enter a file ID')
      return
    }
    if (!file) {
      setError('Please select a file')
      return
    }

    setLoading(true)
    setError(undefined)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('file_id', fileId.toString())
      formData.append('search_mode', searchMode)

      const response = await fetch('/api/v1/bulk-search/bulk-excel-search', {
        method: 'POST',
        body: formData,
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.detail || 'Search failed')
      }

      const data = await response.json()
      setResults(data)
      showToast(`Search completed! Found ${data.upload_summary.found_matches} matches`, 'success')
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Search failed'
      setError(errorMsg)
      showToast(errorMsg, 'error')
    } finally {
      setLoading(false)
    }
  }, [fileId, file, searchMode, showToast])

  const handleExport = useCallback(async (format: 'excel' | 'csv') => {
    if (!results) return

    try {
      const response = await fetch('/api/v1/bulk-search/bulk-search-export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ results, format })
      })

      if (!response.ok) {
        throw new Error('Export failed')
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `bulk_search_results.${format === 'excel' ? 'xlsx' : 'csv'}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)

      showToast(`Results exported as ${format.toUpperCase()}`, 'success')
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Export failed'
      showToast(errorMsg, 'error')
    }
  }, [results, showToast])

  const getMatchStatusBadge = (status: string) => {
    switch (status) {
      case 'found':
        return <Badge variant="success">Found</Badge>
      case 'partial':
        return <Badge variant="warning">Partial</Badge>
      case 'not_found':
        return <Badge variant="error">Not Found</Badge>
      default:
        return <Badge variant="secondary">{status}</Badge>
    }
  }

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return 'text-green-600'
    if (confidence >= 60) return 'text-yellow-600'
    return 'text-red-600'
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Bulk Excel Part Number Search</h1>
        <div className="flex gap-2">
          {results && (
            <>
              <Button onClick={() => handleExport('excel')} variant="secondary">
                📊 Export Excel
              </Button>
              <Button onClick={() => handleExport('csv')} variant="secondary">
                📄 Export CSV
              </Button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md">
          <div className="text-sm text-red-600">{error}</div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upload Section */}
        <Card>
          <CardHeader title="Upload Excel File" description="Upload your Excel file with part numbers to search" />
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                type="number"
                className="w-full sm:w-32"
                placeholder="File ID"
                value={fileId || ''}
                onChange={e => setFileId(parseInt(e.target.value || '0'))}
                disabled={loading}
              />
              <select
                className="border rounded px-3 py-2 text-sm"
                value={searchMode}
                onChange={e => setSearchMode(e.target.value as 'exact' | 'fuzzy' | 'hybrid')}
                disabled={loading}
              >
                <option value="exact">Exact Match</option>
                <option value="fuzzy">Fuzzy Match</option>
                <option value="hybrid">Hybrid Search</option>
              </select>
            </div>

            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
              }`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileSelect}
                className="hidden"
              />
              
              <div className="space-y-2">
                <div className="text-4xl">📁</div>
                <div className="text-sm text-gray-600">
                  {file ? (
                    <div>
                      <div className="font-medium">{file.name}</div>
                      <div className="text-xs">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
                    </div>
                  ) : (
                    <div>
                      Drag & drop your Excel file here, or{' '}
                      <button
                        className="text-blue-600 hover:underline"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        browse
                      </button>
                    </div>
                  )}
                </div>
                <div className="text-xs text-gray-500">
                  Expected format: Part Number, Part name, Quantity, Manufacturer name
                </div>
              </div>
            </div>

            <Button
              onClick={handleSearch}
              disabled={loading || !file || !fileId}
              className="w-full"
            >
              {loading ? <Spinner size={16} /> : '🔍 Search Parts'}
            </Button>
          </CardContent>
        </Card>

        {/* Results Summary */}
        {results && (
          <Card>
            <CardHeader title="Search Summary" />
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-3 bg-gray-50 rounded">
                  <div className="text-2xl font-bold text-blue-600">{results.upload_summary.total_parts}</div>
                  <div className="text-sm text-gray-600">Total Parts</div>
                </div>
                <div className="text-center p-3 bg-green-50 rounded">
                  <div className="text-2xl font-bold text-green-600">{results.upload_summary.found_matches}</div>
                  <div className="text-sm text-gray-600">Found Matches</div>
                </div>
                <div className="text-center p-3 bg-yellow-50 rounded">
                  <div className="text-2xl font-bold text-yellow-600">{results.upload_summary.partial_matches}</div>
                  <div className="text-sm text-gray-600">Partial Matches</div>
                </div>
                <div className="text-center p-3 bg-red-50 rounded">
                  <div className="text-2xl font-bold text-red-600">{results.upload_summary.no_matches}</div>
                  <div className="text-sm text-gray-600">No Matches</div>
                </div>
              </div>
              <div className="mt-4 text-sm text-gray-600">
                <div>Processing time: {results.upload_summary.processing_time_ms}ms</div>
                <div>File: {results.file_info.filename}</div>
                <div>Search mode: {results.file_info.search_mode}</div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Results Table */}
      {results && (
        <Card>
          <CardHeader title="Search Results" description="Detailed results for each part" />
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User Part</TableHead>
                    <TableHead>Match Status</TableHead>
                    <TableHead>Found Part</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead>Match Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(Array.isArray(results.results) ? results.results : []).slice(0, 100).map((result, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="font-medium">{result.user_data.part_number}</div>
                          <div className="text-sm text-gray-600">{result.user_data.part_name}</div>
                          <div className="text-xs text-gray-500">Qty: {result.user_data.quantity}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {getMatchStatusBadge(result.search_result.match_status)}
                      </TableCell>
                      <TableCell>
                        {result.search_result.match_status !== 'not_found' ? (
                          <div className="space-y-1">
                            <div className="font-medium">{result.search_result.database_record.part_number}</div>
                            <div className="text-sm text-gray-600">{result.search_result.database_record.item_description}</div>
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {result.search_result.match_status !== 'not_found' ? (
                          <div className="space-y-1">
                            <div className="font-medium">{result.search_result.database_record.company_name}</div>
                            <div className="text-sm text-gray-600">{result.search_result.database_record.email}</div>
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {result.search_result.match_status !== 'not_found' ? (
                          <div className="text-right">
                            <div className="font-medium">${result.search_result.price_calculation.unit_price.toFixed(2)}</div>
                            <div className="text-sm text-gray-600">Total: ${result.search_result.price_calculation.total_cost.toFixed(2)}</div>
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className={`font-medium ${getConfidenceColor(result.search_result.confidence)}`}>
                          {result.search_result.confidence.toFixed(1)}%
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-gray-600">{result.search_result.match_type}</div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {results.results.length > 100 && (
              <div className="mt-4 text-sm text-gray-600 text-center">
                Showing first 100 results of {results.results.length} total
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
