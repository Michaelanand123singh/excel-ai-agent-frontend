import { useState, useMemo } from 'react'  // ✅ removed React
import { Card, CardContent, CardHeader } from './ui/Card'
import { Button } from './ui/Button'
import { Badge } from './ui/Badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './ui/Table'
import { StatsCard } from './ui/StatsCard'
import { EmptyState, EmptyStateIcons } from './ui/EmptyState'
import { TableSkeleton, CardSkeleton } from './ui/Skeleton'  // ✅ removed Skeleton
import { Pagination } from './ui/Pagination'


interface Company {
  company_name: string
  contact_details: string
  email: string
  quantity: number | string
  unit_price: number | string
  uqc: string
  item_description: string
  part_number?: string
}

interface SearchResultsProps {
  results: {
    companies: Company[]
    total_matches: number
    part_number: string
    message: string
    latency_ms: number
    cached: boolean
    price_summary?: {
      min_price: number
      max_price: number
      total_quantity: number
      avg_price: number
    }
  } | undefined
  loading: boolean
  onExportCSV: () => void
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  onShowAllChange: (showAll: boolean) => void
  currentPage: number
  pageSize: number
  showAll: boolean
}

export function SearchResults({
  results,
  loading,
  onExportCSV,
  onPageChange,
  onPageSizeChange,
  onShowAllChange,
  currentPage,
  pageSize,
  showAll
}: SearchResultsProps) {
  const [sortField, setSortField] = useState<keyof Company | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  const sortedCompanies = useMemo(() => {
    if (!sortField || !results?.companies) return results?.companies || []
    
    return [...(results?.companies || [])].sort((a, b) => {
      const aVal = a[sortField]
      const bVal = b[sortField]
      
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal
      }
      
      const aStr = String(aVal || '')
      const bStr = String(bVal || '')
      
      return sortDirection === 'asc' 
        ? aStr.localeCompare(bStr)
        : bStr.localeCompare(aStr)
    })
  }, [results?.companies, sortField, sortDirection])

  const handleSort = (field: keyof Company) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  const formatPrice = (price: number | string) => {
    if (typeof price === 'number') {
      return `$${price.toFixed(2)}`
    }
    return String(price || 'N/A')
  }

  const formatQuantity = (qty: number | string) => {
    if (typeof qty === 'number') {
      return qty.toLocaleString()
    }
    return String(qty || 'N/A')
  }

  const getPerformanceColor = (latency: number) => {
    if (latency < 500) return 'text-green-600'
    if (latency < 1000) return 'text-yellow-600'
    return 'text-red-600'
  }

  const totalPages = Math.ceil(results?.total_matches / pageSize) || 1
  const startIndex = (currentPage - 1) * pageSize
  const endIndex = Math.min(startIndex + pageSize, results?.total_matches || 0)

  if (loading) {
    return (
      <Card>
        <CardHeader title="Search Results" />
        <CardContent>
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
            <TableSkeleton rows={5} columns={7} />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!results) {
    return (
      <Card>
        <CardHeader title="Search Results" />
        <CardContent>
          <EmptyState
            icon={EmptyStateIcons.search}
            title="No search performed"
            description="Enter a part number and click search to see results"
          />
        </CardContent>
      </Card>
    )
  }

  // Additional safety check for results structure
  if (!results.companies || !Array.isArray(results.companies)) {
    return (
      <Card>
        <CardHeader title="Search Results" />
        <CardContent>
          <EmptyState
            icon={EmptyStateIcons.error}
            title="Invalid results format"
            description="The search results are not in the expected format"
          />
        </CardContent>
      </Card>
    )
  }

  if (!results.companies || results.companies.length === 0) {
    return (
      <Card>
        <CardHeader title="Search Results" />
        <CardContent>
          <EmptyState
            icon={EmptyStateIcons.data}
            title="No companies found"
            description={`No companies found with part number "${results?.part_number || 'N/A'}"`}
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <StatsCard
  title="Total Matches"
  value={results?.total_matches !== undefined 
    ? results.total_matches.toLocaleString() 
    : '0'}
  subtitle={`Found for "${results?.part_number || 'N/A'}"`}
  ...
/>

        
        <StatsCard
          title="Price Range"
          value={results.price_summary && 
                 typeof results.price_summary.min_price === 'number' && 
                 typeof results.price_summary.max_price === 'number' ? 
            `$${results.price_summary.min_price.toFixed(2)} - $${results.price_summary.max_price.toFixed(2)}` : 
            'N/A'
          }
          subtitle={results.price_summary && 
                   typeof results.price_summary.avg_price === 'number' ? 
            `Avg: $${results.price_summary.avg_price.toFixed(2)}` : 
            'No price data'
          }
          icon={
            <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
              </svg>
            </div>
          }
        />
        
        <StatsCard
          title="Total Quantity"
          value={results.price_summary && 
                 typeof results.price_summary.total_quantity === 'number' ? 
            results.price_summary.total_quantity.toLocaleString() : 
            'N/A'
          }
          subtitle="Available units"
          icon={
            <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
          }
        />
        
        <StatsCard
          title="Response Time"
          value={`${results?.latency_ms || 0}ms`}
          subtitle={results?.cached ? 'Cached result' : 'Live query'}
          icon={
            <div className="w-8 h-8 bg-yellow-100 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
          }
        />
      </div>

      {/* Results Table */}
      <Card>
        <CardHeader 
          title="Search Results" 
          description={`Showing ${startIndex + 1}-${endIndex} of ${results?.total_matches || 0} companies`}
        />
        <CardContent>
          {/* Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">Page size:</label>
                <select 
                  className="border border-gray-300 rounded-md px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={pageSize} 
                  onChange={(e) => onPageSizeChange(parseInt(e.target.value))}
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
              
              <label className="flex items-center gap-2">
                <input 
                  type="checkbox" 
                  checked={showAll}
                  onChange={(e) => onShowAllChange(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-gray-700">Show all results</span>
              </label>
            </div>
            
            <div className="flex items-center gap-2">
              <Badge variant={results?.cached ? 'info' : 'secondary'}>
                {results?.cached ? '📦 Cached' : '🔄 Live'}
              </Badge>
              <Badge variant={(results?.latency_ms || 0) < 1000 ? 'success' : 'warning'}>
                ⚡ {results?.latency_ms || 0}ms
              </Badge>
              <Button 
                variant="secondary"
                onClick={onExportCSV}
                disabled={!results?.companies || results.companies.length === 0}
              >
                📊 Export CSV
              </Button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead 
                    className="cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('company_name')}
                  >
                    <div className="flex items-center gap-1">
                      Company
                      {sortField === 'company_name' && (
                        <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('contact_details')}
                  >
                    <div className="flex items-center gap-1">
                      Contact
                      {sortField === 'contact_details' && (
                        <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('email')}
                  >
                    <div className="flex items-center gap-1">
                      Email
                      {sortField === 'email' && (
                        <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="cursor-pointer hover:bg-gray-100 text-right"
                    onClick={() => handleSort('quantity')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      Quantity
                      {sortField === 'quantity' && (
                        <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="cursor-pointer hover:bg-gray-100 text-right"
                    onClick={() => handleSort('unit_price')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      Unit Price
                      {sortField === 'unit_price' && (
                        <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('uqc')}
                  >
                    <div className="flex items-center gap-1">
                      UQC
                      {sortField === 'uqc' && (
                        <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('item_description')}
                  >
                    <div className="flex items-center gap-1">
                      Description
                      {sortField === 'item_description' && (
                        <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedCompanies
                  .slice(startIndex, endIndex)
                  .map((company, index) => (
                    <TableRow key={index} className="hover:bg-gray-50">
                      <TableCell className="font-medium">
                        <div className="max-w-xs truncate" title={company.company_name}>
                          {company.company_name || 'N/A'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="max-w-xs truncate" title={company.contact_details}>
                          {company.contact_details || 'N/A'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="max-w-xs truncate" title={company.email}>
                          {company.email || 'N/A'}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatQuantity(company.quantity)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatPrice(company.unit_price)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {company.uqc || 'N/A'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="max-w-xs truncate text-gray-600" title={company.item_description}>
                          {company.item_description || 'N/A'}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-6">
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={onPageChange}
                maxVisiblePages={5}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
