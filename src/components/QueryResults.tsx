import React from 'react'
import { Card, CardContent, CardHeader } from './ui/Card'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { EmptyState, EmptyStateIcons } from './ui/EmptyState'
import { Skeleton, CardSkeleton } from './ui/Skeleton'

interface QueryResultsProps {
  results: {
    answer?: string
    route?: string
    confidence?: number
    latency_ms?: number
    cached?: boolean
    sql?: {
      query?: string
    }
    semantic?: Array<{
      id?: string
      text?: string
      score?: number
    }>
  } | undefined
  loading: boolean
  onCopyAnswer?: () => void
  onCopySQL?: () => void
}

export function QueryResults({ 
  results, 
  loading, 
  onCopyAnswer, 
  onCopySQL 
}: QueryResultsProps) {
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'text-green-600'
    if (confidence >= 0.6) return 'text-yellow-600'
    return 'text-red-600'
  }

  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 0.8) return 'success'
    if (confidence >= 0.6) return 'warning'
    return 'error'
  }

  const getPerformanceColor = (latency: number) => {
    if (latency < 500) return 'text-green-600'
    if (latency < 1000) return 'text-yellow-600'
    return 'text-red-600'
  }

  const getRouteIcon = (route: string) => {
    switch (route?.toLowerCase()) {
      case 'sql':
        return '🗄️'
      case 'semantic':
        return '🔍'
      case 'hybrid':
        return '⚡'
      default:
        return '❓'
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader title="Answer" />
          <CardContent>
            <CardSkeleton />
          </CardContent>
        </Card>
        <Card>
          <CardHeader title="SQL Preview" />
          <CardContent>
            <CardSkeleton />
          </CardContent>
        </Card>
        <Card>
          <CardHeader title="Semantic Matches" />
          <CardContent>
            <CardSkeleton />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!results) {
    return (
      <Card>
        <CardHeader title="Answer" />
        <CardContent>
          <EmptyState
            icon={EmptyStateIcons.search}
            title="No query executed"
            description="Enter a question and click send to see results"
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Main Answer */}
      <Card>
        <CardHeader 
          title="Answer" 
          description="AI-generated response to your query"
        />
        <CardContent>
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-4 border-l-4 border-blue-500">
              <p className="text-gray-900 leading-relaxed">
                {results.answer || 'No answer available'}
              </p>
            </div>
            
            {/* Metadata */}
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Badge variant="info">
                {getRouteIcon(results.route || '')} {results.route || 'Unknown'}
              </Badge>
              
              <Badge variant={getConfidenceBadge(results.confidence || 0)}>
                Confidence: {Math.round((results.confidence || 0) * 100)}%
              </Badge>
              
              <Badge variant={results.latency_ms && results.latency_ms < 1000 ? 'success' : 'warning'}>
                ⚡ {results.latency_ms || 0}ms
              </Badge>
              
              {results.cached && (
                <Badge variant="info">
                  📦 Cached
                </Badge>
              )}
            </div>
            
            {/* Action Buttons */}
            <div className="flex gap-2">
              {onCopyAnswer && (
                <Button 
                  variant="secondary" 
                  onClick={onCopyAnswer}
                  className="text-sm"
                >
                  📋 Copy Answer
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SQL Preview */}
      {results.sql?.query && (
        <Card>
          <CardHeader 
            title="SQL Query" 
            description="Generated SQL query for your question"
          />
          <CardContent>
            <div className="space-y-3">
              <div className="bg-gray-900 text-green-400 rounded-lg p-4 overflow-x-auto">
                <pre className="text-sm font-mono whitespace-pre-wrap">
                  {results.sql.query}
                </pre>
              </div>
              
              {onCopySQL && (
                <Button 
                  variant="secondary" 
                  onClick={onCopySQL}
                  className="text-sm"
                >
                  📋 Copy SQL
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Semantic Matches */}
      {results.semantic && results.semantic.length > 0 && (
        <Card>
          <CardHeader 
            title="Semantic Matches" 
            description="Related content found in your dataset"
          />
          <CardContent>
            <div className="space-y-3">
              {results.semantic.map((match, index) => (
                <div key={index} className="border rounded-lg p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="secondary">
                          ID: {match.id || 'Unknown'}
                        </Badge>
                        {match.score && (
                          <Badge variant="info">
                            Score: {(match.score * 100).toFixed(1)}%
                          </Badge>
                        )}
                      </div>
                      <p className="text-gray-700 text-sm leading-relaxed">
                        {match.text || 'No text available'}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Performance Insights */}
      <Card>
        <CardHeader 
          title="Performance Insights" 
          description="Query execution details"
        />
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <div className="text-2xl font-bold text-gray-900">
                {results.latency_ms || 0}ms
              </div>
              <div className="text-sm text-gray-600">Response Time</div>
              <div className={`text-xs mt-1 ${
                results.latency_ms && results.latency_ms < 1000 ? 'text-green-600' : 'text-yellow-600'
              }`}>
                {results.latency_ms && results.latency_ms < 1000 ? 'Fast' : 'Moderate'}
              </div>
            </div>
            
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <div className="text-2xl font-bold text-gray-900">
                {Math.round((results.confidence || 0) * 100)}%
              </div>
              <div className="text-sm text-gray-600">Confidence</div>
              <div className={`text-xs mt-1 ${getConfidenceColor(results.confidence || 0)}`}>
                {results.confidence && results.confidence >= 0.8 ? 'High' : 
                 results.confidence && results.confidence >= 0.6 ? 'Medium' : 'Low'}
              </div>
            </div>
            
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <div className="text-2xl font-bold text-gray-900">
                {results.cached ? '📦' : '🔄'}
              </div>
              <div className="text-sm text-gray-600">Source</div>
              <div className="text-xs mt-1 text-gray-500">
                {results.cached ? 'Cached' : 'Live Query'}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
