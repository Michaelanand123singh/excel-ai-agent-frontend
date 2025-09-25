import { useEffect, useState, useCallback, useRef } from 'react'
import { Card, CardContent, CardHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Spinner } from '../components/ui/Spinner'
import { SearchResults } from '../components/SearchResults'
import { QueryResults } from '../components/QueryResults'
import { queryDataset, searchPartNumber, searchPartNumberBulkUpload, searchPartNumberBulkUltraFast } from '../lib/api'
import { useSearchParams } from 'react-router-dom'
import { useToast } from '../hooks/useToast'
// removed auto-search debounce

export default function QueryPage() {
  type Company = {
    company_name: string;
    contact_details: string;
    email: string;
    quantity: number | string;
    unit_price: number | string;
    uqc: string;
    item_description: string;
    part_number?: string;
    secondary_buyer?: string;
    secondary_buyer_contact?: string;
    secondary_buyer_email?: string;
  };

  type PartSearchResult = {
    companies: Company[];
    total_matches: number;
    part_number: string;
    message?: string;
    latency_ms?: number;
    cached?: boolean;
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
  type ErrorResult = { error: string }
  type BulkEntry = PartSearchResult | ErrorResult
  type QueryResponse = { answer?: string; sql?: { query?: string } } | undefined

  const [fileId, setFileId] = useState<number>(0)
  const [q, setQ] = useState('count rows')
  const [res, setRes] = useState<QueryResponse>()
  const [partNumber, setPartNumber] = useState('')
  const [bulkInput, setBulkInput] = useState('')
  const [bulkResults, setBulkResults] = useState<Record<string, BulkEntry> | null>(null)
  const [bulkUploading, setBulkUploading] = useState(false)
  const [partResults, setPartResults] = useState<PartSearchResult | undefined>()
  const [partPage, setPartPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [showAll, setShowAll] = useState(false)
  const [searchMode, setSearchMode] = useState<'exact' | 'fuzzy' | 'hybrid'>('hybrid')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [activeTab, setActiveTab] = useState<'query' | 'part'>('query')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [params] = useSearchParams()
  const { showToast } = useToast()

  function isErrorResult(x: BulkEntry): x is ErrorResult {
    return (x as Record<string, unknown>).error !== undefined
  }
  
  // Check authentication status
  const checkAuth = useCallback(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      showToast('Please log in to use the search functionality', 'error');
      return false;
    }
    return true;
  }, [showToast]);
  
  const runBulkUpload = useCallback(
    async (f: File) => {
      if (!checkAuth()) return;
      if (!fileId) return setError("Please enter a file ID");
      setBulkUploading(true);
      setError(undefined);
      // Clear single search area when starting bulk upload
      setPartNumber('');
      setPartResults(undefined);
      try {
        const r = await searchPartNumberBulkUpload(fileId, f);
        setBulkResults(r.results as unknown as Record<string, BulkEntry>);
        // Don't automatically populate single search area - let user choose which part to view
        showToast(
          `Searched ${r.total_parts} part numbers from file`,
          "success"
        );
      } catch (err: unknown) {
        const errorMsg =
          (err as { response?: { data?: { detail?: string } } })?.response?.data
            ?.detail || (err as Error)?.message || "Bulk upload failed";
        setError(errorMsg);
        showToast(errorMsg, "error");
      } finally {
        setBulkUploading(false);
      }
    },
    [fileId, showToast, checkAuth]
  );
  
  
  // Manual search only; no debounce auto-trigger
  
  useEffect(()=>{
    const id = parseInt(params.get('fileId') || '0')
    if (id) setFileId(id)
  },[params])

  const ask = useCallback(async () => {
    if (!fileId) return setError("Please enter a file ID");
    setLoading(true);
    setError(undefined);
    try {
      const r = await queryDataset(fileId, q);
      setRes(r as QueryResponse);
      showToast("Query executed successfully!", "success");
    } catch (err: unknown) {
      const errorMsg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail || "Query failed";
      setError(errorMsg);
      showToast(errorMsg, "error");
    } finally {
      setLoading(false);
    }
  }, [fileId, q, showToast]);

  const searchPart = useCallback(async () => {
    if (!checkAuth()) return;
    if (!fileId) return setError("Please enter a file ID");
    if (!partNumber) return setError("Please enter a part number");
    setLoading(true);
    setError(undefined);
    try {
      const r = await searchPartNumber(
        fileId,
        partNumber,
        1,
        pageSize,
        showAll,
        searchMode
      );
      setPartResults(r as unknown as PartSearchResult);
      setPartPage(1);
      showToast(
        `Found ${r.total_matches} matches for ${partNumber}`,
        "success"
      );
    } catch (err: unknown) {
      const errorMsg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail || (err as Error)?.message || "Search failed";
      setError(errorMsg);
      showToast(errorMsg, "error");
    } finally {
      setLoading(false);
    }
  }, [fileId, partNumber, pageSize, showAll, searchMode, showToast, checkAuth]);

  const runBulkTextSearch = useCallback(async () => {
    if (!checkAuth()) return;
    if (!fileId) return setError("Please enter a file ID");
    const parts = bulkInput
      .split(/[\n,]/g)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2)
      .slice(0, 10000);
    if (parts.length === 0)
      return setError("Enter at least one part number (min 2 characters)");
    setLoading(true);
    setError(undefined);
    // Clear single search area when starting bulk search
    setPartNumber('');
    setPartResults(undefined);
    try {
      const r = await searchPartNumberBulkUltraFast(
        fileId,
        parts,
        1,
        pageSize,
        showAll,
        searchMode
      );
      setBulkResults(r.results as unknown as Record<string, BulkEntry>);
      // Don't automatically populate single search area - let user choose which part to view
      showToast(`Searched ${r.total_parts} part numbers`, "success");
    } catch (err: unknown) {
      const errorMsg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail || (err as Error)?.message || "Bulk search failed";
      setError(errorMsg);
      showToast(errorMsg, "error");
    } finally {
      setLoading(false);
    }
  }, [fileId, bulkInput, pageSize, showAll, searchMode, showToast, checkAuth]);


  function exportCompaniesToCSV(
    rows: Company[],
    filename = "part_search_export.csv"
  ) {
    if (!Array.isArray(rows) || rows.length === 0) return;
    const headers: (keyof Company)[] = [
      "company_name",
      "contact_details",
      "email",
      "quantity",
      "unit_price",
      "uqc",
      "part_number",
      "item_description",
      "secondary_buyer",
      "secondary_buyer_contact",
      "secondary_buyer_email",
    ];
    const escape = (val: unknown) => {
      if (val == null) return "";
      const s = String(val);
      if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const lines = [headers.join(",")];
    for (const row of rows) {
      lines.push(headers.map((h) => escape(row[h] as string)).join(","));
    }
    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // --- JSX ---
  return (
    <div className="space-y-6">
      {/* --- Tabs & Error --- */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Query Dataset</h1>
        <div className="flex gap-2">
          <Button
            variant={activeTab === "query" ? "primary" : "secondary"}
            onClick={() => setActiveTab("query")}
            disabled={loading}
          >
            Natural Language Query
          </Button>
          <Button
            variant={activeTab === "part" ? "primary" : "secondary"}
            onClick={() => setActiveTab("part")}
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

      <div className="w-full">
        <div className="space-y-4">
          {activeTab === "query" ? (
            <>
              <Card>
                <CardHeader
                  title="Natural Language Query"
                  description="Ask questions about your data in plain English"
                />
                <CardContent>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input
                      type="number"
                      className="w-full sm:w-28"
                      placeholder="file id"
                      value={fileId || ""}
                      onChange={(e) =>
                        setFileId(parseInt(e.target.value || "0"))
                      }
                      disabled={loading}
                    />
                    <Input
                      className="flex-1"
                      placeholder="Ask about your data..."
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      disabled={loading}
                    />
                    <Button onClick={ask} disabled={loading}>
                      {loading ? <Spinner size={16} /> : "Send"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
             <QueryResults
  results={res ?? {}}
  loading={loading}
  onCopyAnswer={() => {
    if (res?.answer) {
      navigator.clipboard.writeText(res.answer as string);
      showToast('Answer copied!', 'success');
    }
  }}
  onCopySQL={() => {
    if (res?.sql?.query) {
      navigator.clipboard.writeText(res.sql.query as string);
      showToast('SQL copied!', 'success');
    }
  }}
/>

            </>
          ) : (
            <>
              {/* --- Part Search UI --- */}
              <Card className="shadow-lg border-0 bg-gradient-to-r from-slate-50 to-gray-50">
                <CardHeader className="border-b border-gray-200 bg-white">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                      <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold text-gray-900">Part Number Search</h2>
                      <p className="text-sm text-gray-600 mt-1">Search for specific part numbers or perform bulk searches across multiple parts</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="md:col-span-1">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Dataset ID</label>
                        <Input
                          type="number"
                          className="w-full"
                          placeholder="Enter dataset ID"
                          value={fileId || ""}
                          onChange={(e) =>
                            setFileId(parseInt(e.target.value || "0"))
                          }
                          disabled={loading}
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Part Number</label>
                        <Input
                          className="w-full"
                          placeholder="Enter part number to search..."
                          value={partNumber}
                          onChange={(e) => setPartNumber(e.target.value)}
                          disabled={loading}
                        />
                      </div>
                      <div className="md:col-span-1 flex items-end">
                        <Button 
                          onClick={searchPart} 
                          disabled={loading}
                          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5"
                        >
                          {loading ? <Spinner size={16} /> : "Search"}
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-3">
                        <label className="block text-sm font-medium text-gray-700">Search Mode</label>
                        <select
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          value={searchMode}
                          onChange={(e) => setSearchMode(e.target.value as 'exact' | 'fuzzy' | 'hybrid')}
                          disabled={loading}
                        >
                          <option value="exact">Exact Match</option>
                          <option value="fuzzy">Fuzzy Search</option>
                          <option value="hybrid">Hybrid (Recommended)</option>
                        </select>
                      </div>
                      <div className="space-y-3">
                        <label className="block text-sm font-medium text-gray-700">Show All Results</label>
                        <div className="flex items-center">
                          <input
                            type="checkbox"
                            id="showAll"
                            checked={showAll}
                            onChange={(e) => setShowAll(e.target.checked)}
                            disabled={loading}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                          />
                          <label htmlFor="showAll" className="ml-2 text-sm text-gray-700">
                            Display all matches (may be slower)
                          </label>
                        </div>
                      </div>
                    </div>
                    
                    <div className="border-t border-gray-200 pt-6">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center">
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </div>
                        <h3 className="text-lg font-semibold text-gray-900">Bulk Search</h3>
                      </div>
                      
                      <div className="space-y-4">
                        <div>
                          <label className="block text sm font-medium text-gray-700 mb-2">
                            Part Numbers (comma or newline separated)
                          </label>
                          <textarea
                            className="w-full border border-gray-300 rounded-lg p-3 min-h-[120px] text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                            placeholder="Enter multiple part numbers separated by commas or new lines...&#10;Example:&#10;PN123, PN456, PN789&#10;or&#10;PN123&#10;PN456&#10;PN789"
                            value={bulkInput}
                            onChange={(e) => setBulkInput(e.target.value)}
                            disabled={loading}
                          />
                        </div>
                        
                        <div className="flex flex-wrap gap-3">
                          <Button 
                            onClick={runBulkTextSearch} 
                            disabled={loading}
                            className="bg-green-600 hover:bg-green-700 text-white font-medium px-6 py-2.5"
                          >
                            {loading ? <Spinner size={16} /> : "Run Bulk Search"}
                          </Button>
                          <Button 
                            variant="secondary" 
                            onClick={() => fileInputRef.current?.click()}
                            disabled={bulkUploading}
                            className="border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium px-6 py-2.5"
                          >
                            {bulkUploading ? <Spinner size={16} /> : '📁 Upload Excel File'}
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
                      
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              {/* --- Bulk Results --- */}
              {bulkResults && (
                <Card className="shadow-lg border-0">
                  <CardHeader className="border-b border-gray-200 bg-gradient-to-r from-green-50 to-emerald-50">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-green-600 rounded-lg flex items-center justify-center">
                          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <div>
                          <h2 className="text-xl font-semibold text-gray-900">Bulk Search Results</h2>
                          <p className="text-sm text-gray-600 mt-1">
                            {Object.keys(bulkResults).length} parts searched • {Object.values(bulkResults).filter(r => !isErrorResult(r) && r.total_matches > 0).length} with results
                          </p>
                        </div>
                      </div>
                      <Button 
                        variant="secondary" 
                        onClick={() => setBulkResults(null)}
                        className="text-sm border border-gray-300 text-gray-700 hover:bg-gray-50"
                      >
                        Clear Results
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {Object.keys(bulkResults).map((pn) => {
                        const entry = bulkResults[pn]
                        const isError = isErrorResult(entry)
                        const totalMatches = isError ? 0 : (entry.total_matches || 0)
                        const searchModeVal = isError ? 'error' : (entry.search_mode || 'hybrid')
                        const matchTypeVal = isError ? 'error' : (entry.match_type || 'n/a')
                        const companies: Company[] = isError ? [] : (entry.companies || [])
                        
                        return (
                          <div
                            key={pn}
                            className={`p-4 border rounded-lg transition-all duration-200 ${
                              partNumber === pn
                                ? "bg-blue-50 border-blue-300 shadow-md"
                                : isError
                                ? "bg-red-50 border-red-200"
                                : "bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm"
                            }`}
                          >
                            <div className="space-y-3">
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <h4 className="font-semibold text-gray-900 text-sm truncate" title={pn}>
                                    {pn}
                                  </h4>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                      totalMatches > 0 
                                        ? 'bg-green-100 text-green-800' 
                                        : isError 
                                        ? 'bg-red-100 text-red-800'
                                        : 'bg-gray-100 text-gray-800'
                                    }`}>
                                      {totalMatches} matches
                                    </span>
                                    <span className="text-xs text-gray-500">
                                      {searchModeVal}:{matchTypeVal}
                                    </span>
                                  </div>
                                  {isError && (
                                    <p className="text-xs text-red-600 mt-1 truncate">
                                      Error: {entry.error}
                                    </p>
                                  )}
                                </div>
                              </div>
                              
                              {!isError && totalMatches > 0 && (
                                <div className="flex gap-2">
                                  <Button
                                    onClick={() => {
                                      setPartNumber(pn);
                                      setPartPage(1);
                                      setPartResults(entry);
                                    }}
                                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs py-1.5 px-3"
                                  >
                                    View Details
                                  </Button>
                                  <Button
                                    variant="secondary"
                                    onClick={() =>
                                      exportCompaniesToCSV(
                                        companies,
                                        `part_${pn}.csv`
                                      )
                                    }
                                    className="text-xs border border-gray-300 text-gray-700 hover:bg-gray-50 py-1.5 px-3"
                                  >
                                    Export
                                  </Button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}
              {/* --- Selected Part Results --- */}
              {partNumber && partResults && (
                <SearchResults
                  results={{
                    companies: partResults.companies,
                    total_matches: partResults.total_matches,
                    part_number: partResults.part_number,
                    message: partResults.message || '',
                    latency_ms: partResults.latency_ms,
                    cached: partResults.cached,
                    price_summary: partResults.price_summary
                      ? {
                          min_price: partResults.price_summary.min_price,
                          max_price: partResults.price_summary.max_price,
                          total_quantity: partResults.price_summary.total_quantity,
                          avg_price: partResults.price_summary.avg_price ?? 0,
                        }
                      : undefined,
                  }}
                  loading={loading}
                  onExportCSV={() =>
                    exportCompaniesToCSV(
                      partResults.companies,
                      `part_search_${partNumber}.csv`
                    )
                  }
                  onPageChange={async (page: number) => {
                    setPartPage(page);
                    if (fileId && partNumber) {
                      const r = await searchPartNumber(
                        fileId,
                        partNumber,
                        page,
                        pageSize,
                        showAll,
                        searchMode
                      );
                      setPartResults(r as unknown as PartSearchResult);
                    }
                  }}
                  onPageSizeChange={async (size) => {
                    setPageSize(size);
                    setPartPage(1);
                    if (fileId && partNumber) {
                      const r = await searchPartNumber(
                        fileId,
                        partNumber,
                        1,
                        size,
                        showAll,
                        searchMode
                      );
                      setPartResults(r as unknown as PartSearchResult);
                    }
                  }}
                  onShowAllChange={async (all) => {
                    setShowAll(all);
                    setPartPage(1);
                    if (fileId && partNumber) {
                      const r = await searchPartNumber(
                        fileId,
                        partNumber,
                        1,
                        pageSize,
                        all,
                        searchMode
                      );
                      setPartResults(r as unknown as PartSearchResult);
                    }
                  }}
                  currentPage={partPage}
                  pageSize={pageSize}
                  showAll={showAll}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
