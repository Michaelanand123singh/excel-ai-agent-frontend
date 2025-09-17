import { create } from 'zustand'
import { login as apiLogin, setAuthToken } from '../lib/api'

type AuthState = {
  token?: string
  username?: string
  isLoading: boolean
  isInitializing: boolean
  error?: string
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  initialize: () => void
}

export const useAuth = create<AuthState>((set) => ({
  token: undefined,
  username: undefined,
  isLoading: false,
  isInitializing: true,
  error: undefined,
  
  initialize() {
    set({ isInitializing: true })
    const savedToken = localStorage.getItem('token')
    if (savedToken) {
      set({ token: savedToken, username: 'user', isInitializing: false })
      setAuthToken(savedToken)
    } else {
      set({ isInitializing: false })
    }
  },
  
  async login(username, password) {
    set({ isLoading: true, error: undefined })
    try {
      const res = await apiLogin(username, password)
      set({ token: res.access_token, username, isLoading: false })
      localStorage.setItem('token', res.access_token)
      setAuthToken(res.access_token)
    } catch (error: any) {
      set({ 
        error: error.response?.data?.detail || 'Login failed', 
        isLoading: false 
      })
      throw error
    }
  },
  
  logout() {
    set({ token: undefined, username: undefined, error: undefined, isInitializing: false })
    localStorage.removeItem('token')
    setAuthToken(undefined)
  },
}))


