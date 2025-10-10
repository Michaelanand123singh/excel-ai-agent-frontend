import { useEffect, useState, useCallback, useRef } from 'react'
import { Card, CardContent, CardHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Spinner } from '../components/ui/Spinner'
import { SearchResults } from '../components/SearchResults'
import { QueryResults } from '../components/QueryResults'
import { queryDataset, searchPartNumber, searchBulkExcelUpload, searchPartNumberBulkChunked, searchAllFilesText, searchAllFilesExcel, getAllFilesStatus } from '../lib/api'
import { useSearchParams } from 'react-router-dom'
import { useToast } from '../hooks/useToast'
import * as XLSX from 'xlsx'
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
    confidence?: number;
    match_type?: string;
    match_status?: string;
    confidence_breakdown?: {
      part_number: { score: number; method: string; details: string };
      description: { score: number; method: string; details: string };
      manufacturer: { score: number; method: string; details: string };
      length_penalty: number;
    };
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
    search_engine?: string
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
  const [bulkProgress, setBulkProgress] = useState<{ completed: number; total: number; current: string } | null>(null)
  const [streamingCount, setStreamingCount] = useState(0)
  const [bulkResultsPage, setBulkResultsPage] = useState(1)
  const [bulkResultsPageSize] = useState(100) // Show 100 results per page for massive datasets (1 crore rows)
  
  const [bulkUploading, setBulkUploading] = useState(false)
  const [partResults, setPartResults] = useState<PartSearchResult | undefined>()
  const [partPage, setPartPage] = useState(1)
  const [pageSize, setPageSize] = useState(100)  // Show more results by default
  const [searchMode, setSearchMode] = useState<'exact' | 'fuzzy' | 'hybrid'>('hybrid')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // All Files Search state
  const [allFilesBulkInput, setAllFilesBulkInput] = useState('')
  const [allFilesBulkResults, setAllFilesBulkResults] = useState<Record<string, BulkEntry> | null>(null)
  const [allFilesBulkProgress, setAllFilesBulkProgress] = useState<{ completed: number; total: number; current: string } | null>(null)
  const [allFilesBulkUploading, setAllFilesBulkUploading] = useState(false)
  const [allFilesStatus, setAllFilesStatus] = useState<{ total_files: number; synced_files: number; files: Array<{ id: number; filename: string; status: string; elasticsearch_synced: boolean; elasticsearch_sync_error: string | null; rows_count: number }> } | null>(null)
  const allFilesFileInputRef = useRef<HTMLInputElement>(null)

  const [activeTab, setActiveTab] = useState<'query' | 'part' | 'all-files'>('query')
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
        // Prefer richer bulk-excel endpoint which understands headers and quantities
        const r = await searchBulkExcelUpload(fileId, f);

        // Backend now returns the same format as text-based search (Record<string, BulkEntry>)
        // Transform the unified response format to match the expected BulkEntry structure
        const transformed: Record<string, BulkEntry> = {};
        
        for (const [partNumber, result] of Object.entries(r.results || {})) {
          if ('error' in result) {
            // Handle error case
            transformed[partNumber] = {
              error: result.error
            } as ErrorResult;
            continue;
          }

          // Handle success case - result is ApiPartSearchResult format
          const companies = result.companies || [];
          transformed[partNumber] = {
            companies: companies,
            total_matches: result.total_matches || 0,
            part_number: partNumber,
            message: result.total_matches > 0 ? 'Match found' : 'No matches',
            latency_ms: result.latency_ms,
            cached: false,
            search_mode: result.search_mode || 'hybrid',
            match_type: result.match_type || 'unknown'
          } as BulkEntry;
        }

        setBulkResults(transformed);
        showToast(
          `Processed ${r.upload_summary?.total_parts || Object.keys(transformed).length} parts from file`,
          'success'
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
        true,  // Always show all results automatically
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
  }, [fileId, partNumber, pageSize, searchMode, showToast, checkAuth]);

  const runBulkTextSearch = useCallback(async () => {
    if (!checkAuth()) return;
    if (!fileId) return setError("Please enter a file ID");
    const parts = bulkInput
      .split(/[\n,]/g)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2)
      .slice(0, 100000); // Support up to 1 lakh parts
    if (parts.length === 0)
      return setError("Enter at least one part number (min 2 characters)");
    setLoading(true);
    setError(undefined);
    setBulkProgress({ completed: 0, total: parts.length, current: "Starting search..." });
    setStreamingCount(0);
    // Clear single search area when starting bulk search
    setPartNumber('');
    setPartResults(undefined);
    try {
      // Use chunked bulk to avoid oversized requests/timeouts, preserves response format
      // For bulk search, always show all results regardless of pageSize/showAll settings
      const r = await searchPartNumberBulkChunked(
        fileId,
        parts,
        1,
        10000000,  // Show ALL results from dataset (up to 1 crore)
        true,  // Always show all results for bulk search
        searchMode,
        { 
          chunkSize: 100, 
          concurrency: 12,
          onProgress: (completed, total, current) => {
            setBulkProgress({ completed, total, current });
          },
          onResults: (streamingResults) => {
            // Stream results immediately as they come in
            // Transform ApiPartSearchResult to BulkEntry format
            const transformed: Record<string, BulkEntry> = {};
            for (const [partNumber, result] of Object.entries(streamingResults)) {
              if ('error' in result) {
                transformed[partNumber] = { error: result.error } as ErrorResult;
              } else {
                // Handle both ApiPartSearchResult and Elasticsearch response formats
                const companies = result.companies || [];
                const totalMatches = result.total_matches || 0;
                
                transformed[partNumber] = {
                  companies: companies,
                  total_matches: totalMatches,
                  part_number: partNumber,
                  message: result.message || (totalMatches > 0 ? 'Match found' : 'No matches'),
                  latency_ms: result.latency_ms || 0,
                  cached: result.cached || false,
                  search_mode: result.search_mode || 'hybrid',
                  match_type: result.match_type || 'unknown',
                  search_engine: result.search_engine || 'unknown'
                } as BulkEntry;
              }
            }
            setBulkResults(transformed);
            setStreamingCount(Object.keys(transformed).length);
            
            // Debug logging for streaming
            console.log('Streaming results update:', {
              count: Object.keys(transformed).length,
              sampleResult: Object.values(transformed)[0],
              hasResults: Object.values(transformed).some(r => !('error' in r) && r.total_matches > 0)
            });
          }
        }
      );
      // Transform final results from ApiPartSearchResult to BulkEntry format
      const finalTransformed: Record<string, BulkEntry> = {};
      for (const [partNumber, result] of Object.entries(r.results)) {
        if ('error' in result) {
          finalTransformed[partNumber] = { error: result.error } as ErrorResult;
        } else {
          // Handle both ApiPartSearchResult and Elasticsearch response formats
          const companies = result.companies || [];
          const totalMatches = result.total_matches || 0;
          
          finalTransformed[partNumber] = {
            companies: companies,
            total_matches: totalMatches,
            part_number: partNumber,
            message: result.message || (totalMatches > 0 ? 'Match found' : 'No matches'),
            latency_ms: result.latency_ms || 0,
            cached: result.cached || false,
            search_mode: result.search_mode || 'hybrid',
            match_type: result.match_type || 'unknown',
            search_engine: result.search_engine || 'unknown'
          } as BulkEntry;
        }
      }
      setBulkResults(finalTransformed);
      setBulkProgress(null);
      setStreamingCount(0); // Reset streaming count when complete
      
      // Debug logging
      console.log('Bulk search completed:', {
        totalParts: r.total_parts,
        resultsCount: Object.keys(finalTransformed).length,
        sampleResult: Object.values(finalTransformed)[0],
        hasResults: Object.values(finalTransformed).some(r => !('error' in r) && r.total_matches > 0),
        allResults: Object.entries(finalTransformed).slice(0, 3).map(([pn, result]) => ({
          partNumber: pn,
          totalMatches: 'error' in result ? 0 : result.total_matches,
          companiesCount: 'error' in result ? 0 : result.companies?.length || 0,
          hasError: 'error' in result
        }))
      });
      
      // Don't automatically populate single search area - let user choose which part to view
      showToast(`✅ Search completed! Found results for ${r.total_parts} part numbers`, "success");
    } catch (err: unknown) {
      const errorMsg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail || (err as Error)?.message || "Bulk search failed";
      setError(errorMsg);
      showToast(errorMsg, "error");
      setBulkProgress(null);
    } finally {
      setLoading(false);
    }
  }, [fileId, bulkInput, searchMode, showToast, checkAuth]);

  // All Files Search Functions
  const loadAllFilesStatus = useCallback(async () => {
    try {
      const status = await getAllFilesStatus();
      setAllFilesStatus(status);
    } catch (err) {
      console.error('Failed to load all files status:', err);
    }
  }, []);

  const runAllFilesTextSearch = useCallback(async () => {
    if (!checkAuth()) return;
    
    const parts = allFilesBulkInput
      .split(/[\n,]/g)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2)
      .slice(0, 50000); // Support up to 50K parts as requested
    
    if (parts.length === 0)
      return setError("Enter at least one part number (min 2 characters)");
    
    setLoading(true);
    setError(undefined);
    setAllFilesBulkProgress({ completed: 0, total: parts.length, current: "Starting all-files search..." });
    
    try {
      const result = await searchAllFilesText(parts, searchMode, 1, 100);
      
      // Transform results to BulkEntry format
      const transformed: Record<string, BulkEntry> = {};
      for (const [partNumber, partResult] of Object.entries(result.results)) {
        transformed[partNumber] = {
          companies: partResult.companies,
          total_matches: partResult.total_matches,
          part_number: partNumber,
          message: partResult.total_matches > 0 ? 'Match found' : 'No matches',
          latency_ms: result.latency_ms,
          cached: result.cached || false,
          search_mode: searchMode,
          match_type: partResult.match_type || 'unknown',
          search_engine: result.search_engine || 'elasticsearch_all_files'
        } as BulkEntry;
      }
      
      setAllFilesBulkResults(transformed);
      setAllFilesBulkProgress(null);
      
      showToast(`✅ All-files search completed! Found results for ${result.total_parts} part numbers across ${result.synced_files_count || 0} files`, "success");
    } catch (err: unknown) {
      const errorMsg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || (err as Error)?.message || "All-files search failed";
      setError(errorMsg);
      showToast(errorMsg, "error");
      setAllFilesBulkProgress(null);
    } finally {
      setLoading(false);
    }
  }, [allFilesBulkInput, searchMode, showToast, checkAuth]);

  const runAllFilesExcelUpload = useCallback(async (f: File) => {
    if (!checkAuth()) return;
    
    setAllFilesBulkUploading(true);
    setError(undefined);
    
    try {
      const result = await searchAllFilesExcel(f, searchMode, 1, 100);
      
      // Transform results to BulkEntry format
      const transformed: Record<string, BulkEntry> = {};
      for (const [partNumber, partResult] of Object.entries(result.results)) {
        transformed[partNumber] = {
          companies: partResult.companies,
          total_matches: partResult.total_matches,
          part_number: partNumber,
          message: partResult.total_matches > 0 ? 'Match found' : 'No matches',
          latency_ms: result.latency_ms,
          cached: result.cached || false,
          search_mode: searchMode,
          match_type: partResult.match_type || 'unknown',
          search_engine: result.search_engine || 'elasticsearch_all_files'
        } as BulkEntry;
      }
      
      setAllFilesBulkResults(transformed);
      
      showToast(`✅ All-files Excel search completed! Found results for ${result.total_parts} part numbers across ${result.synced_files_count || 0} files`, "success");
    } catch (err: unknown) {
      const errorMsg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || (err as Error)?.message || "All-files Excel search failed";
      setError(errorMsg);
      showToast(errorMsg, "error");
    } finally {
      setAllFilesBulkUploading(false);
    }
  }, [searchMode, showToast, checkAuth]);

  // Load all files status when component mounts or when switching to all-files tab
  useEffect(() => {
    if (activeTab === 'all-files') {
      loadAllFilesStatus();
    }
  }, [activeTab, loadAllFilesStatus]);

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

  function exportAllBulkResultsToExcel() {
    if (!bulkResults || Object.keys(bulkResults).length === 0) {
      showToast("No bulk search results to export", "error");
      return;
    }

    // Check if search is still in progress
    if (bulkProgress && bulkProgress.completed < bulkProgress.total) {
      const confirmExport = window.confirm(
        `Search is still in progress (${bulkProgress.completed}/${bulkProgress.total} chunks completed).\n\n` +
        `Currently loaded: ${Object.keys(bulkResults).length.toLocaleString()} results\n` +
        `Do you want to export the current results, or wait for completion?`
      );
      if (!confirmExport) {
        return;
      }
    }

    // Prepare data for Excel export
    const allCompanies: (Company & { searched_part_number: string })[] = [];
    
    Object.entries(bulkResults).forEach(([partNumber, entry]) => {
      if (!isErrorResult(entry) && entry.companies && entry.companies.length > 0) {
        entry.companies.forEach(company => {
          allCompanies.push({
            ...company,
            searched_part_number: partNumber,
            part_number: company.part_number || partNumber
          });
        });
      }
    });

    if (allCompanies.length === 0) {
      showToast("No company data found in bulk search results", "error");
      return;
    }

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    
    // Prepare headers with searched part number first
    const headers = [
      "searched_part_number",
      "company_name", 
      "contact_details",
      "email",
      "quantity",
      "unit_price",
      "uqc",
      "item_description",
      "part_number",
      "secondary_buyer",
      "secondary_buyer_contact", 
      "secondary_buyer_email"
    ];

    // Convert data to worksheet format
    const wsData = [
      headers, // Header row
      ...allCompanies.map(company => 
        headers.map(header => company[header as keyof typeof company] || "")
      )
    ];

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    
    // Auto-size columns
    const colWidths = headers.map(header => ({
      wch: Math.max(header.length, 15) // Minimum width of 15 characters
    }));
    ws['!cols'] = colWidths;

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, "Bulk Search Results");

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '_');
    const filename = `bulk_search_results_${timestamp}.xlsx`;

    // Save file
    XLSX.writeFile(wb, filename);
    
    showToast(`Exported ${allCompanies.length} companies from ${Object.keys(bulkResults).length} part numbers to Excel`, "success");
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
          <Button
            variant={activeTab === "all-files" ? "primary" : "secondary"}
            onClick={() => setActiveTab("all-files")}
            disabled={loading}
          >
            All Files Search
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
          ) : activeTab === "part" ? (
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
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="space-y-3">
                        <label className="block text-sm font-medium text-gray-700">Search Mode</label>
                        <select
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          value={searchMode}
                          onChange={(e) => setSearchMode(e.target.value as 'exact' | 'fuzzy' | 'hybrid')}
                          disabled={loading}
                        >
                          <option value="exact">Exact Match (Fastest)</option>
                          <option value="fuzzy">Fuzzy Search</option>
                          <option value="hybrid">Hybrid (Recommended - Fast)</option>
                        </select>
                      </div>
                      <div className="space-y-3">
                        <label className="block text-sm font-medium text-gray-700">Page Size</label>
                        <select
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          value={pageSize}
                          onChange={(e) => setPageSize(parseInt(e.target.value))}
                          disabled={loading}
                        >
                          <option value={10}>10 results (Fastest)</option>
                          <option value={20}>20 results</option>
                          <option value={50}>50 results</option>
                          <option value={100}>100 results (Recommended)</option>
                          <option value={500}>500 results</option>
                          <option value={1000}>1000 results</option>
                        </select>
                      </div>
                      <div className="text-xs text-gray-500 bg-blue-50 p-2 rounded">
                        💡 <strong>Performance Tip:</strong> System automatically shows all results. 
                        Exact match mode is fastest for known part numbers.
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
                          <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                            <div className="flex items-start">
                              <div className="flex-shrink-0">
                                <svg className="h-5 w-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                              </div>
                              <div className="ml-3">
                                <h3 className="text-sm font-medium text-yellow-800">
                                  Massive Dataset Support
                                </h3>
                                <div className="mt-1 text-sm text-yellow-700">
                                  <p>This system supports datasets with 1+ crore rows. If a part has 50 lakh matches, ALL matches will be shown.</p>
                                  <p className="mt-1"><strong>Performance:</strong> Results are streamed and paginated for optimal performance.</p>
                                </div>
                              </div>
                            </div>
                          </div>
                          {bulkInput.split(/[\n,]/g).filter(s => s.trim().length >= 2).length > 1000 && (
                            <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                              <div className="flex items-start gap-2">
                                <svg className="w-5 h-5 text-yellow-600 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                                <div className="text-sm">
                                  <p className="font-medium text-yellow-800">Large Dataset Detected</p>
                                  <p className="text-yellow-700 mt-1">
                                    {bulkInput.split(/[\n,]/g).filter(s => s.trim().length >= 2).length} parts detected. 
                                    For optimal performance with 1+ crore datasets, results are limited to top 50 matches per part.
                                    Processing will show progress and may take 30 seconds to 3 minutes for large datasets.
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}
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
                          {bulkResults && Object.keys(bulkResults).length > 0 && (
                            <Button 
                              onClick={exportAllBulkResultsToExcel}
                              className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-2.5"
                            >
                              📊 Export All to Excel
                              {bulkProgress && bulkProgress.completed < bulkProgress.total && (
                                <span className="ml-2 text-xs bg-yellow-500 text-white px-2 py-1 rounded">
                                  ({Object.keys(bulkResults).length.toLocaleString()} loaded)
                                </span>
                              )}
                            </Button>
                          )}
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
                        
                        {/* Progress Indicator for Large Datasets */}
                        {bulkProgress && (
                          <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium text-blue-900">
                                Processing {bulkProgress.total.toLocaleString()} parts...
                              </span>
                              <span className="text-sm text-blue-700">
                                {bulkProgress.completed}/{bulkProgress.total} chunks ({Math.round((bulkProgress.completed / bulkProgress.total) * 100)}%)
                              </span>
                            </div>
                            <div className="w-full bg-blue-200 rounded-full h-3">
                              <div 
                                className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                                style={{ width: `${(bulkProgress.completed / bulkProgress.total) * 100}%` }}
                              />
                            </div>
                            <div className="mt-2 flex justify-between text-xs text-blue-600">
                              <span>{bulkProgress.current}</span>
                              {streamingCount > 0 && (
                                <span className="text-green-600 font-medium">
                                  📊 {streamingCount.toLocaleString()} results streaming in...
                                </span>
                              )}
                            </div>
                            {streamingCount > 0 && (
                              <div className="mt-2 text-xs text-green-600 bg-green-50 p-2 rounded">
                                ✅ Results are appearing in real-time! You can browse them while processing continues.
                              </div>
                            )}
                          </div>
                        )}
                      
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              {/* --- Bulk Results --- */}
              {bulkResults && (() => {
                console.log('Rendering bulk results:', {
                  hasResults: !!bulkResults,
                  resultCount: Object.keys(bulkResults).length,
                  sampleKeys: Object.keys(bulkResults).slice(0, 3),
                  sampleValues: Object.values(bulkResults).slice(0, 2)
                });
                return true;
              })() && (
                <Card className="shadow-lg border-0">
                  <CardHeader className="border-b border-gray-200 bg-gradient-to-r from-green-50 to-emerald-50">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-green-600 rounded-lg flex items-center justify-center">
                          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <div>
                          <h2 className="text-xl font-semibold text-gray-900">Bulk Search Results</h2>
                          <p className="text-sm text-gray-600 mt-1">
                            {Object.keys(bulkResults).length.toLocaleString()} parts searched • {Object.values(bulkResults).filter(r => !isErrorResult(r) && r.total_matches > 0).length.toLocaleString()} with results
                            {(() => {
                              const errorCount = Object.values(bulkResults).filter(r => isErrorResult(r)).length;
                              const successCount = Object.values(bulkResults).filter(r => !isErrorResult(r) && r.total_matches > 0).length;
                              const noMatchCount = Object.values(bulkResults).filter(r => !isErrorResult(r) && r.total_matches === 0).length;
                              console.log('Bulk results summary:', { errorCount, successCount, noMatchCount, total: Object.keys(bulkResults).length });
                              return null;
                            })()}
                            {Object.keys(bulkResults).length > 10000 && (
                              <span className="ml-2 text-xs text-blue-600">
                                (Large dataset - results paginated for performance)
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2 self-start sm:self-auto">
                        <Button 
                          variant="secondary" 
                          onClick={() => setBulkResults(null)}
                          className="text-sm border border-gray-300 text-gray-700 hover:bg-gray-50"
                        >
                          Clear Results
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-6">
                    <div className="space-y-6">
                      {/* Pagination Controls for Large Results */}
                      {Object.keys(bulkResults).length > bulkResultsPageSize && (
                        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                          <div className="text-sm text-gray-600">
                            Showing {((bulkResultsPage - 1) * bulkResultsPageSize) + 1} to {Math.min(bulkResultsPage * bulkResultsPageSize, Object.keys(bulkResults).length)} of {Object.keys(bulkResults).length} results
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="secondary"
                              onClick={() => setBulkResultsPage(Math.max(1, bulkResultsPage - 1))}
                              disabled={bulkResultsPage === 1}
                              className="text-sm"
                            >
                              Previous
                            </Button>
                            <span className="px-3 py-1 text-sm bg-white border rounded">
                              Page {bulkResultsPage} of {Math.ceil(Object.keys(bulkResults).length / bulkResultsPageSize)}
                            </span>
                            <Button
                              variant="secondary"
                              onClick={() => setBulkResultsPage(Math.min(Math.ceil(Object.keys(bulkResults).length / bulkResultsPageSize), bulkResultsPage + 1))}
                              disabled={bulkResultsPage >= Math.ceil(Object.keys(bulkResults).length / bulkResultsPageSize)}
                              className="text-sm"
                            >
                              Next
                            </Button>
                          </div>
                        </div>
                      )}
                      
                      {Object.keys(bulkResults)
                        .slice((bulkResultsPage - 1) * bulkResultsPageSize, bulkResultsPage * bulkResultsPageSize)
                        .map((pn) => {
                        const entry = bulkResults[pn]
                        const isError = isErrorResult(entry)
                        const totalMatches = isError ? 0 : (entry.total_matches || 0)
                        const searchModeVal = isError ? 'error' : (entry.search_mode || 'hybrid')
                        const matchTypeVal = isError ? 'error' : (entry.match_type || 'n/a')
                        const companies: Company[] = isError ? [] : (entry.companies || [])
                        
                        return (
                          <div
                            key={pn}
                            className={`border rounded-lg transition-all duration-200 ${
                              isError
                                ? "bg-red-50 border-red-200"
                                : "bg-white border-gray-200 shadow-sm"
                            }`}
                          >
                            {/* Part Number Header */}
                            <div className="p-4 border-b bg-gray-50">
                              <div className="flex items-center justify-between">
                                <div className="flex-1">
                                  <h4 className="font-semibold text-gray-900 text-lg" title={pn}>
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
                                    <p className="text-sm text-red-600 mt-1">
                                      Error: {entry.error}
                                    </p>
                                  )}
                                </div>
                                {!isError && totalMatches > 0 && (
                                  <Button
                                    variant="secondary"
                                    onClick={() =>
                                      exportCompaniesToCSV(
                                        companies,
                                        `part_${pn}.csv`
                                      )
                                    }
                                    className="text-sm border border-gray-300 text-gray-700 hover:bg-gray-50 px-3 py-1.5"
                                  >
                                    📊 Export CSV
                                  </Button>
                                )}
                              </div>
                            </div>
                            
                            {/* Company Results */}
                            {!isError && totalMatches > 0 && (
                              <div className="p-4">
                                {companies.length > 0 ? (
                                  <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-gray-200">
                                      <thead className="bg-gray-50">
                                        <tr>
                                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 bg-gray-50">Match %</th>
                                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Company</th>
                                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contact</th>
                                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Quantity</th>
                                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Unit Price</th>
                                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">UQC</th>
                                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
                                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Secondary Buyer</th>
                                        </tr>
                                      </thead>
                                      <tbody className="bg-white divide-y divide-gray-200">
                                        {companies.map((company, index) => (
                                          <tr key={index} className="hover:bg-gray-50">
                                            <td className="px-3 py-2 text-sm font-mono text-gray-900 sticky left-0 bg-white z-10">
                                              {company.confidence !== undefined ? (
                                                <span 
                                                  className={(() => {
                                                    const pct = company.confidence
                                                    return pct >= 95 ? 'text-green-600' : pct >= 70 ? 'text-emerald-600' : pct >= 40 ? 'text-yellow-600' : 'text-gray-500'
                                                  })()}
                                                  title={company.confidence_breakdown ? 
                                                    `Part: ${company.confidence_breakdown.part_number.score.toFixed(1)}% (${company.confidence_breakdown.part_number.method})\n` +
                                                    `Desc: ${company.confidence_breakdown.description.score.toFixed(1)}% (${company.confidence_breakdown.description.method})\n` +
                                                    `Mfg: ${company.confidence_breakdown.manufacturer.score.toFixed(1)}% (${company.confidence_breakdown.manufacturer.method})` 
                                                    : undefined
                                                  }
                                                >
                                                  {company.confidence.toFixed(1)}%
                                                </span>
                                              ) : (
                                                <span className="text-gray-400">—</span>
                                              )}
                                            </td>
                                            <td className="px-3 py-2 text-sm font-medium text-gray-900">
                                              <div className="max-w-xs truncate" title={company.company_name}>
                                                {company.company_name || 'N/A'}
                                              </div>
                                            </td>
                                            <td className="px-3 py-2 text-sm text-gray-500">
                                              <div className="max-w-xs truncate" title={company.contact_details}>
                                                {company.contact_details || 'N/A'}
                                              </div>
                                            </td>
                                            <td className="px-3 py-2 text-sm text-gray-500">
                                              <div className="max-w-xs truncate" title={company.email}>
                                                {company.email || 'N/A'}
                                              </div>
                                            </td>
                                            <td className="px-3 py-2 text-sm text-gray-900 text-right font-mono">
                                              {typeof company.quantity === 'number' ? company.quantity.toLocaleString() : (company.quantity || 'N/A')}
                                            </td>
                                            <td className="px-3 py-2 text-sm text-gray-900 text-right font-mono">
                                              {typeof company.unit_price === 'number' ? `₹${company.unit_price.toFixed(2)}` : (company.unit_price || 'N/A')}
                                            </td>
                                            <td className="px-3 py-2 text-sm text-gray-500">
                                              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                                                {company.uqc || 'N/A'}
                                              </span>
                                            </td>
                                            <td className="px-3 py-2 text-sm text-gray-500">
                                              <div className="max-w-xs truncate" title={company.item_description}>
                                                {company.item_description || 'N/A'}
                                              </div>
                                            </td>
                                            <td className="px-3 py-2 text-sm text-gray-500">
                                              {company.secondary_buyer ? (
                                                <div className="max-w-xs">
                                                  <div className="font-medium truncate" title={company.secondary_buyer}>{company.secondary_buyer}</div>
                                                  <div className="text-xs text-gray-500 truncate" title={company.secondary_buyer_contact || ''}>{company.secondary_buyer_contact || ''}</div>
                                                  <div className="text-xs text-gray-500 truncate" title={company.secondary_buyer_email || ''}>{company.secondary_buyer_email || ''}</div>
                                                </div>
                                              ) : (
                                                <span className="text-gray-400">N/A</span>
                                              )}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                    {companies.length > 100 && (
                                      <div className="mt-3 text-sm text-gray-500 text-center">
                                        Showing all {companies.length} companies. Use export for large datasets.
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="text-center py-4 text-gray-500">
                                    No company data available for this part number.
                                  </div>
                                )}
                              </div>
                            )}
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
                        true,  // Always show all results automatically
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
                        true,  // Always show all results automatically
                        searchMode
                      );
                      setPartResults(r as unknown as PartSearchResult);
                    }
                  }}
                  currentPage={partPage}
                  pageSize={pageSize}
                />
              )}
            </>
          ) : activeTab === "all-files" ? (
            <>
              {/* --- All Files Search UI --- */}
              <Card className="shadow-lg border-0 bg-gradient-to-r from-green-50 to-emerald-50">
                <CardHeader className="border-b border-gray-200 bg-white">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-600 rounded-lg flex items-center justify-center">
                      <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold text-gray-900">All Files Search</h2>
                      <p className="text-sm text-gray-600 mt-1">Search across ALL synced files using Elasticsearch - up to 50K part numbers</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="space-y-4">
                    {/* Files Status */}
                    {allFilesStatus && (
                      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="text-sm font-medium text-blue-900">Files Status</h3>
                            <p className="text-sm text-blue-700">
                              {allFilesStatus.synced_files} of {allFilesStatus.total_files} files synced to Elasticsearch
                            </p>
                          </div>
                          <div className="text-right">
                            <div className="text-2xl font-bold text-blue-600">{allFilesStatus.synced_files}</div>
                            <div className="text-xs text-blue-500">Synced Files</div>
                          </div>
                        </div>
                        {allFilesStatus.synced_files === 0 && (
                          <div className="mt-2 p-2 bg-yellow-100 border border-yellow-300 rounded text-sm text-yellow-800">
                            ⚠️ No files are synced to Elasticsearch yet. Upload and process files first.
                          </div>
                        )}
                      </div>
                    )}

                    {/* Search Mode and Page Size */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-3">
                        <label className="block text-sm font-medium text-gray-700">Search Mode</label>
                        <select
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
                          value={searchMode}
                          onChange={(e) => setSearchMode(e.target.value as 'exact' | 'fuzzy' | 'hybrid')}
                          disabled={loading}
                        >
                          <option value="exact">Exact Match (Fastest)</option>
                          <option value="fuzzy">Fuzzy Search</option>
                          <option value="hybrid">Hybrid (Recommended - Fast)</option>
                        </select>
                      </div>
                      <div className="space-y-3">
                        <label className="block text-sm font-medium text-gray-700">Page Size</label>
                        <select
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
                          value={pageSize}
                          onChange={(e) => setPageSize(parseInt(e.target.value))}
                          disabled={loading}
                        >
                          <option value={10}>10 results (Fastest)</option>
                          <option value={20}>20 results</option>
                          <option value={50}>50 results</option>
                          <option value={100}>100 results (Recommended)</option>
                          <option value={500}>500 results</option>
                          <option value={1000}>1000 results</option>
                        </select>
                      </div>
                    </div>
                    
                    <div className="border-t border-gray-200 pt-6">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center">
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </div>
                        <h3 className="text-lg font-semibold text-gray-900">Bulk Search Across All Files</h3>
                      </div>
                      
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Part Numbers (comma or newline separated)
                          </label>
                          <textarea
                            className="w-full border border-gray-300 rounded-lg p-3 min-h-[120px] text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 resize-none"
                            placeholder="Enter multiple part numbers separated by commas or new lines...&#10;Example:&#10;PN123, PN456, PN789&#10;or&#10;PN123&#10;PN456&#10;PN789"
                            value={allFilesBulkInput}
                            onChange={(e) => setAllFilesBulkInput(e.target.value)}
                            disabled={loading}
                          />
                          <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                            <div className="flex items-start">
                              <div className="flex-shrink-0">
                                <svg className="h-5 w-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                              </div>
                              <div className="ml-3">
                                <h3 className="text-sm font-medium text-green-800">
                                  All Files Search
                                </h3>
                                <div className="mt-1 text-sm text-green-700">
                                  <p>Search across ALL synced files simultaneously using Elasticsearch.</p>
                                  <p className="mt-1"><strong>Performance:</strong> Supports up to 50K part numbers with Redis caching for speed.</p>
                                </div>
                              </div>
                            </div>
                          </div>
                          {allFilesBulkInput.split(/[\n,]/g).filter(s => s.trim().length >= 2).length > 1000 && (
                            <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                              <div className="flex items-start gap-2">
                                <svg className="w-5 h-5 text-yellow-600 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                                <div className="text-sm">
                                  <p className="font-medium text-yellow-800">Large Dataset Detected</p>
                                  <p className="text-yellow-700 mt-1">
                                    {allFilesBulkInput.split(/[\n,]/g).filter(s => s.trim().length >= 2).length} parts detected. 
                                    Results are limited to top matches per part for optimal performance.
                                    Processing may take 30 seconds to 3 minutes for large datasets.
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                        
                        <div className="flex flex-wrap gap-3">
                          <Button 
                            onClick={runAllFilesTextSearch} 
                            disabled={loading || !allFilesStatus?.synced_files}
                            className="bg-green-600 hover:bg-green-700 text-white font-medium px-6 py-2.5"
                          >
                            {loading ? <Spinner size={16} /> : "Search All Files"}
                          </Button>
                          <Button 
                            variant="secondary" 
                            onClick={() => allFilesFileInputRef.current?.click()}
                            disabled={allFilesBulkUploading || !allFilesStatus?.synced_files}
                            className="border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium px-6 py-2.5"
                          >
                            {allFilesBulkUploading ? <Spinner size={16} /> : '📁 Upload Excel File'}
                          </Button>
                          {allFilesBulkResults && Object.keys(allFilesBulkResults).length > 0 && (
                            <Button 
                              onClick={() => {
                                const allCompanies = Object.values(allFilesBulkResults)
                                  .filter(result => !('error' in result))
                                  .flatMap(result => ('companies' in result ? result.companies : []));
                                exportCompaniesToCSV(allCompanies, "all_files_search_export.csv");
                              }}
                              className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-2.5"
                            >
                              📊 Export All to CSV
                            </Button>
                          )}
                          <input 
                            ref={allFilesFileInputRef}
                            type="file" 
                            accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                            onChange={e => {
                              const f = e.target.files?.[0]
                              if (f) runAllFilesExcelUpload(f)
                            }}
                            disabled={allFilesBulkUploading || !allFilesStatus?.synced_files}
                            className="hidden"
                          />
                        </div>
                        
                        {/* Progress Indicator */}
                        {allFilesBulkProgress && (
                          <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium text-green-900">
                                Processing {allFilesBulkProgress.total.toLocaleString()} parts...
                              </span>
                              <span className="text-sm text-green-700">
                                {allFilesBulkProgress.completed} / {allFilesBulkProgress.total}
                              </span>
                            </div>
                            <div className="w-full bg-green-200 rounded-full h-2">
                              <div 
                                className="bg-green-600 h-2 rounded-full transition-all duration-300"
                                style={{ width: `${(allFilesBulkProgress.completed / allFilesBulkProgress.total) * 100}%` }}
                              />
                            </div>
                            <div className="mt-2 text-xs text-green-700">
                              {allFilesBulkProgress.current}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* All Files Search Results */}
              {allFilesBulkResults && Object.keys(allFilesBulkResults).length > 0 && (
                <Card className="shadow-lg border-0">
                  <CardHeader className="border-b border-gray-200 bg-gradient-to-r from-green-50 to-emerald-50">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-green-600 rounded-lg flex items-center justify-center">
                          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <div>
                          <h2 className="text-xl font-semibold text-gray-900">All Files Search Results</h2>
                          <p className="text-sm text-gray-600 mt-1">
                            {Object.keys(allFilesBulkResults).length.toLocaleString()} parts searched across all files • {Object.values(allFilesBulkResults).filter(r => !isErrorResult(r) && r.total_matches > 0).length.toLocaleString()} with results
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2 self-start sm:self-auto">
                        <Button 
                          variant="secondary" 
                          onClick={() => setAllFilesBulkResults(null)}
                          className="text-sm border border-gray-300 text-gray-700 hover:bg-gray-50"
                        >
                          Clear Results
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-6">
                    <div className="space-y-6">
                      {Object.keys(allFilesBulkResults).map((pn) => {
                        const entry = allFilesBulkResults[pn];
                        const isError = isErrorResult(entry);
                        const totalMatches = isError ? 0 : (entry.total_matches || 0);
                        const searchModeVal = isError ? 'error' : (entry.search_mode || 'hybrid');
                        const matchTypeVal = isError ? 'error' : (entry.match_type || 'n/a');
                        const companies: Company[] = isError ? [] : (entry.companies || []);
                        
                        return (
                          <div
                            key={pn}
                            className={`border rounded-lg transition-all duration-200 ${
                              isError
                                ? "bg-red-50 border-red-200"
                                : "bg-white border-gray-200 shadow-sm"
                            }`}
                          >
                            {/* Part Number Header */}
                            <div className="p-4 border-b bg-gray-50">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <h3 className="text-lg font-semibold text-gray-900">{pn}</h3>
                                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                    isError
                                      ? "bg-red-100 text-red-800"
                                      : totalMatches > 0
                                      ? "bg-green-100 text-green-800"
                                      : "bg-gray-100 text-gray-800"
                                  }`}>
                                    {isError ? "Error" : totalMatches > 0 ? `${totalMatches} matches` : "No matches"}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 text-sm text-gray-500">
                                  <span>Mode: {searchModeVal}</span>
                                  <span>•</span>
                                  <span>Type: {matchTypeVal}</span>
                                </div>
                              </div>
                            </div>
                            
                            {/* Results Content */}
                            <div className="p-4">
                              {isError ? (
                                <div className="text-red-600 text-sm">
                                  Error: {(entry as ErrorResult).error}
                                </div>
                              ) : totalMatches > 0 ? (
                                <div className="space-y-3">
                                  <div className="text-sm text-gray-600">
                                    Found {totalMatches} companies with this part number across all files
                                  </div>
                                  <div className="grid gap-3">
                                    {companies.slice(0, 5).map((company, idx) => (
                                      <div key={idx} className="p-3 bg-gray-50 rounded-lg border">
                                        <div className="flex justify-between items-start">
                                          <div className="flex-1">
                                            <div className="font-medium text-gray-900">{company.company_name}</div>
                                            <div className="text-sm text-gray-600 mt-1">
                                              {company.contact_details} • {company.email}
                                            </div>
                                            <div className="text-sm text-gray-500 mt-1">
                                              Qty: {company.quantity} • Price: ${company.unit_price} • UQC: {company.uqc}
                                            </div>
                                            <div className="text-xs text-gray-400 mt-1">
                                              File ID: {(company as Company & { file_id?: number }).file_id || 'Unknown'} • Confidence: {company.confidence || 0}%
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                    {companies.length > 5 && (
                                      <div className="text-sm text-gray-500 text-center py-2">
                                        ... and {companies.length - 5} more results
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex gap-2">
                                    <Button
                                      variant="secondary"
                                      onClick={() => {
                                        if (!isError) {
                                          setPartResults(entry as PartSearchResult);
                                        }
                                      }}
                                      className="text-sm"
                                    >
                                      View All Results
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-gray-500 text-sm">
                                  No matches found for this part number across all files
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

            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
