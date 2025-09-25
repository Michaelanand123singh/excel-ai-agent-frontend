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

  const [activeTab, setActiveTab] = useState<'query' | 'part'>('query')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [debugInfo, setDebugInfo] = useState<string>('')
  const [params] = useSearchParams()
  const { showToast } = useToast()
  
  // Check authentication status
  const checkAuth = useCallback(() => {
    const token = localStorage.getItem('token');
    console.log('Auth token status:', token ? 'Present' : 'Missing');
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
      try {
        console.log('Starting bulk upload with:', { fileId, fileName: f.name, fileSize: f.size });
        const r = await searchPartNumberBulkUpload(fileId, f);
        console.log('Bulk upload result:', r);
        setBulkResults(
          r.results as unknown as Record<string, PartSearchResult>
        );
        const first = Object.keys(r.results || {})[0];
        if (first) {
          setPartNumber(first);
          setPartPage(1);
          // Set the detailed results for the first part to show in the table
          const firstResult = r.results[first] as unknown as PartSearchResult;
          if (firstResult && !(firstResult as any).error) {
            setPartResults(firstResult);
          }
        }
        showToast(
          `Searched ${r.total_parts} part numbers from file`,
          "success"
        );
      } catch (err: unknown) {
        console.error('Bulk upload error:', err);
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
  }, [runBulkUpload])
  
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
      setRes(r);
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
      console.log('Starting single part search with:', { fileId, partNumber, pageSize, showAll, searchMode });
      const r = await searchPartNumber(
        fileId,
        partNumber,
        1,
        pageSize,
        showAll,
        searchMode
      );
      console.log('Single part search result:', r);
      setPartResults(r as unknown as PartSearchResult);
      setPartPage(1);
      showToast(
        `Found ${r.total_matches} matches for ${partNumber}`,
        "success"
      );
    } catch (err: unknown) {
      console.error('Single part search error:', err);
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
    try {
      console.log('Starting bulk search with:', { fileId, parts: parts.slice(0, 5), pageSize, showAll, searchMode });
      const r = await searchPartNumberBulk(
        fileId,
        parts,
        1,
        pageSize,
        showAll,
        searchMode
      );
      console.log('Bulk search result:', r);
      setBulkResults(r.results as unknown as Record<string, PartSearchResult>);
      const first = Object.keys(r.results || {})[0];
      if (first) {
        setPartNumber(first);
        setPartPage(1);
        // Set the detailed results for the first part to show in the table
        const firstResult = r.results[first] as unknown as PartSearchResult;
        if (firstResult && !(firstResult as any).error) {
          setPartResults(firstResult);
        }
      }
      showToast(`Searched ${r.total_parts} part numbers`, "success");
    } catch (err: unknown) {
      console.error('Bulk search error:', err);
      const errorMsg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail || (err as Error)?.message || "Bulk search failed";
      setError(errorMsg);
      showToast(errorMsg, "error");
    } finally {
      setLoading(false);
    }
  }, [fileId, bulkInput, pageSize, showAll, searchMode, showToast, checkAuth]);

  async function testSearch() {
    if (!fileId) return setError("Please enter a file ID");
    setLoading(true);
    setError(undefined);
    try {
      const result = await testSearchEndpoint(fileId);
      setDebugInfo(JSON.stringify(result, null, 2));
      showToast("Debug info retrieved successfully!", "success");
    } catch (err: unknown) {
      const errorMsg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail || "Debug test failed";
      setError(errorMsg);
      showToast(errorMsg, "error");
    } finally {
      setLoading(false);
    }
  }

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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-4">
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
      navigator.clipboard.writeText((res.sql as any).query);
      showToast('SQL copied!', 'success');
    }
  }}
/>

            </>
          ) : (
            <>
              {/* --- Part Search UI --- */}
              <Card>
                <CardHeader
                  title="Part Number Search"
                  description="Find companies that have a specific part number or run bulk searches"
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
                      placeholder="Enter part number..."
                      value={partNumber}
                      onChange={(e) => setPartNumber(e.target.value)}
                      disabled={loading}
                    />
                    <Button onClick={searchPart} disabled={loading}>
                      {loading ? <Spinner size={16} /> : "Search"}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={testSearch}
                      disabled={loading}
                    >
                      {loading ? <Spinner size={16} /> : "Debug"}
                    </Button>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-3">
                    <div className="flex items-center gap-3">
                      <label className="text-sm font-medium">Search mode</label>
                      <select
                        className="border rounded px-2 py-1 text-sm"
                        value={searchMode}
                        onChange={(e) => setSearchMode(e.target.value as any)}
                        disabled={loading}
                      >
                        <option value="exact">Exact</option>
                        <option value="fuzzy">Fuzzy</option>
                        <option value="hybrid">Hybrid</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-medium">
                        Part numbers (comma or newline separated)
                      </label>
                      <textarea
                        className="mt-1 w-full border rounded p-2 min-h-[100px]"
                        placeholder="e.g. PN123, PN456"
                        value={bulkInput}
                        onChange={(e) => setBulkInput(e.target.value)}
                        disabled={loading}
                      />
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <Button onClick={runBulkTextSearch} disabled={loading}>
                          {loading ? <Spinner size={16} /> : "Run Search"}
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
              {/* --- Bulk Results --- */}
              {bulkResults && (
                <Card>
                  <CardHeader 
                    title="Bulk Results" 
                    description={`Grouped by part number - ${Object.keys(bulkResults).length} parts searched`}
                  />
                  <CardContent>
                    <div className="mb-4 flex justify-between items-center">
                      <div className="text-sm text-gray-600">
                        Found results for {Object.values(bulkResults).filter(r => r && !(r as any).error && (r as any).total_matches > 0).length} out of {Object.keys(bulkResults).length} parts
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
                        const r = bulkResults[pn];
                        const isError = (r as any)?.error;
                        const totalMatches = isError ? 0 : (r as any)?.total_matches || 0;
                        const searchMode = isError ? "error" : (r as any)?.search_mode || "hybrid";
                        const matchType = isError ? "error" : (r as any)?.match_type || "n/a";
                        const companies = isError ? [] : (r as any)?.companies || [];
                        
                        return (
                          <div
                            key={pn}
                            className={`p-3 border rounded ${
                              partNumber === pn
                                ? "bg-blue-50 border-blue-200"
                                : isError
                                ? "bg-red-50 border-red-200"
                                : ""
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="font-medium">
                                {pn} — {totalMatches} matches{" "}
                                <span className="text-xs text-gray-500">
                                  [{searchMode}:{matchType}]
                                </span>
                                {isError && (
                                  <span className="text-xs text-red-500 ml-2">
                                    Error: {(r as any).error}
                                  </span>
                                )}
                              </div>
                              <div className="flex gap-2">
                                {!isError && (
                                  <>
                                    <Button
                                      variant="secondary"
                                      onClick={() => {
                                        setPartNumber(pn);
                                        setPartPage(1);
                                        // Set the detailed results for this part to show in the table
                                        const partResult = bulkResults[pn] as unknown as PartSearchResult;
                                        if (partResult && !(partResult as any).error) {
                                          setPartResults(partResult);
                                        }
                                      }}
                                    >
                                      View details
                                    </Button>
                                    <Button
                                      variant="secondary"
                                      onClick={() =>
                                        exportCompaniesToCSV(
                                          companies,
                                          `part_${pn}.csv`
                                        )
                                      }
                                    >
                                      Export CSV
                                    </Button>
                                  </>
                                )}
                              </div>
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
                  results={partResults as any}
                  loading={loading}
                  onExportCSV={() =>
                    exportCompaniesToCSV(
                      partResults.companies as any,
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
                      setPartResults(r as any);
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
                      setPartResults(r as any);
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
                      setPartResults(r as any);
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
  );
}
