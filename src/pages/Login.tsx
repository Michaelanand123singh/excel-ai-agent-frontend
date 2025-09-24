import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Spinner } from '../components/ui/Spinner'
import { useAuth } from '../store/auth'
import { useToast } from '../hooks/useToast'

export default function LoginPage() {
  const [email, setEmail] = useState('')
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
    
    if (!email.trim()) {
      showToast('Please enter an email address', 'error')
      return
    }
    
    if (!password.trim()) {
      showToast('Please enter a password', 'error')
      return
    }

    setIsLoading(true)
    try {
      await login(email.trim(), password.trim())
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
    setEmail('info@opt2deal.com')
    setPassword('Opt2deal123')
    setIsLoading(true)
    try {
      await login('info@opt2deal.com', 'Opt2deal123')
      showToast('Login successful! Redirecting...', 'success')
      navigate('/dashboard')
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || 'Login failed'
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
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                  Email Address
                </label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
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
                  <span className="px-2 bg-white text-gray-500">Or use default credentials</span>
                </div>
              </div>

              <Button
                variant="secondary"
                onClick={handleDemoLogin}
                disabled={isLoading}
                className="w-full mt-4"
              >
                {isLoading ? <Spinner size={16} /> : 'Quick Login'}
              </Button>
            </div>

            <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-md">
              <h3 className="text-sm font-medium text-blue-800 mb-2">System Credentials:</h3>
              <div className="text-xs text-blue-700 space-y-1">
                <div><strong>Email:</strong> info@opt2deal.com</div>
                <div><strong>Password:</strong> Opt2deal123</div>
                <div className="text-blue-600 mt-2">
                  Use the credentials above or click "Quick Login" to auto-fill them.
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
