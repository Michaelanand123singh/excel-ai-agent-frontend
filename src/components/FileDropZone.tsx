import React, { useCallback, useState } from 'react'
import { Card, CardContent } from './ui/Card'
import { Button } from './ui/Button'
import { Spinner } from './ui/Spinner'

interface FileDropZoneProps {
  onFileSelect: (file: File) => void
  onTestUpload: () => void
  uploading: boolean
  disabled?: boolean
  maxFileSize?: number // in MB
  acceptedTypes?: string[]
}

export function FileDropZone({ 
  onFileSelect, 
  onTestUpload, 
  uploading, 
  disabled = false,
  maxFileSize = 500, // 500MB default
  acceptedTypes = ['.csv', '.xlsx', '.xls']
}: FileDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [dragCounter, setDragCounter] = useState(0)

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragCounter(prev => prev + 1)
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragOver(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragCounter(prev => prev - 1)
    if (dragCounter === 1) {
      setIsDragOver(false)
    }
  }, [dragCounter])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    setDragCounter(0)

    if (disabled || uploading) return

    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) {
      const file = files[0]
      validateAndSelectFile(file)
    }
  }, [disabled, uploading])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      const file = files[0]
      validateAndSelectFile(file)
    }
  }, [])

  const validateAndSelectFile = (file: File) => {
    // Check file size
    const fileSizeMB = file.size / (1024 * 1024)
    if (fileSizeMB > maxFileSize) {
      alert(`File size (${fileSizeMB.toFixed(1)}MB) exceeds maximum allowed size (${maxFileSize}MB)`)
      return
    }

    // Check file type
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase()
    if (!acceptedTypes.includes(fileExtension)) {
      alert(`File type ${fileExtension} is not supported. Please use: ${acceptedTypes.join(', ')}`)
      return
    }

    onFileSelect(file)
  }


  return (
    <Card>
      <CardContent className="p-6">
        <div
          className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            isDragOver
              ? 'border-blue-400 bg-blue-50'
              : 'border-gray-300 hover:border-gray-400'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <input
            type="file"
            accept={acceptedTypes.join(',')}
            onChange={handleFileInput}
            disabled={disabled || uploading}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
          
          <div className="space-y-4">
            <div className="text-6xl">
              {uploading ? '⏳' : isDragOver ? '📁' : '📄'}
            </div>
            
            <div>
              <h3 className="text-lg font-medium text-gray-900">
                {uploading ? 'Uploading...' : isDragOver ? 'Drop file here' : 'Upload your dataset'}
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                {uploading 
                  ? 'Please wait while your file is being processed'
                  : 'Drag and drop your file here, or click to browse'
                }
              </p>
            </div>

            {uploading && (
              <div className="flex items-center justify-center">
                <Spinner size={24} />
              </div>
            )}

            {!uploading && (
              <div className="space-y-2">
                <div className="text-xs text-gray-500">
                  Supported formats: {acceptedTypes.join(', ')}
                </div>
                <div className="text-xs text-gray-500">
                  Maximum file size: {maxFileSize}MB
                </div>
              </div>
            )}
          </div>
        </div>

        {!uploading && (
          <div className="mt-4 flex justify-center gap-3">
            <Button
              variant="secondary"
              onClick={onTestUpload}
              disabled={disabled}
              className="text-sm"
            >
              Use Sample Data
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
