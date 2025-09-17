import { create } from 'zustand'
import { listFiles } from '../lib/api'

export type Dataset = { 
  id: number
  filename: string
  status: string
  size_bytes: number
  content_type: string
  storage_path?: string
  rows_count: number
}

type DatasetsState = {
  files: Dataset[]
  isLoading: boolean
  error?: string
  loadFiles: () => Promise<void>
  addFile: (file: Dataset) => void
  removeFile: (id: number) => void
  updateFile: (id: number, updates: Partial<Dataset>) => void
}

export const useDatasets = create<DatasetsState>((set, get) => ({
  files: [],
  isLoading: false,
  error: undefined,
  
  async loadFiles() {
    // Guard: skip if already loading or already loaded
    const state = get()
    if (state.isLoading) return
    // Skip when not authenticated (token not set)
    const token = localStorage.getItem('token')
    if (!token) {
      set({ files: [], isLoading: false, error: undefined })
      return
    }
    set({ isLoading: true, error: undefined })
    try {
      const files = await listFiles()
      set({ files, isLoading: false })
    } catch (error: any) {
      set({ 
        error: error.response?.data?.detail || 'Failed to load files',
        isLoading: false 
      })
    }
  },
  
  addFile(file) {
    set((state) => ({
      files: [file, ...state.files.filter(f => f.id !== file.id)]
    }))
  },
  
  removeFile(id) {
    set((state) => ({
      files: state.files.filter(f => f.id !== id)
    }))
  },
  
  updateFile(id, updates) {
    set((state) => ({
      files: state.files.map(f => 
        f.id === id ? { ...f, ...updates } : f
      )
    }))
  },
}))


