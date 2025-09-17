import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Spinner } from '../components/ui/Spinner'
import { useAuth } from '../store/auth'
import { useToast } from '../hooks/useToast'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const { login, token, initialize } = useAuth()
  const navigate = useNavigate()
  const { showToast } = useToast()

  // Initialize auth state on mount
  useEffect(() => {
    initialize()
  }, [initialize])

  // Redirect if already logged in
  useEffect(() => {
    if (token) {
      navigate('/dashboard')
    }
  }, [token, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!username.trim()) {
      showToast('Please enter a username', 'error')
      return
    }
    
    if (!password.trim()) {
      showToast('Please enter a password', 'error')
      return
    }

    setIsLoading(true)
    try {
      await login(username.trim(), password.trim())
      showToast('Login successful! Redirecting...', 'success')
      navigate('/dashboard')
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || 'Login failed. Please check your credentials.'
      showToast(errorMsg, 'error')
    } finally {
      setIsLoading(false)
    }
  }

  const handleDemoLogin = async () => {
    setUsername('demo')
    setPassword('demo123')
    setIsLoading(true)
    try {
      await login('demo', 'demo123')
      showToast('Demo login successful! Redirecting...', 'success')
      navigate('/dashboard')
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || 'Demo login failed'
      showToast(errorMsg, 'error')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Excel AI Agents</h1>
          <p className="text-gray-600">Sign in to access your dashboard</p>
        </div>

        <Card>
          <CardHeader 
            title="Welcome Back" 
            description="Enter your credentials to access the system"
          />
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1">
                  Username
                </label>
                <Input
                  id="username"
                  type="text"
                  placeholder="Enter your username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={isLoading}
                  className="w-full"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                  Password
                </label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  className="w-full"
                />
              </div>

              <Button
                type="submit"
                disabled={isLoading}
                className="w-full"
              >
                {isLoading ? <Spinner size={16} /> : 'Sign In'}
              </Button>
            </form>

            <div className="mt-6">
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-300" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-white text-gray-500">Or try a demo</span>
                </div>
              </div>

              <Button
                variant="secondary"
                onClick={handleDemoLogin}
                disabled={isLoading}
                className="w-full mt-4"
              >
                {isLoading ? <Spinner size={16} /> : 'Demo Login'}
              </Button>
            </div>

            <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-md">
              <h3 className="text-sm font-medium text-blue-800 mb-2">Demo Credentials:</h3>
              <div className="text-xs text-blue-700 space-y-1">
                <div><strong>Username:</strong> demo</div>
                <div><strong>Password:</strong> demo123</div>
                <div className="text-blue-600 mt-2">
                  Or use any username/password combination - the backend accepts all credentials for now.
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="mt-6 text-center text-sm text-gray-500">
          <p>Excel AI Agents - Intelligent Data Analysis Platform</p>
        </div>
      </div>
    </div>
  )
}
