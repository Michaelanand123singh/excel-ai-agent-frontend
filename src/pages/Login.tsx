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
            description="Please sign in with your account credentials"
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

            <div className="mt-4 text-center">
              <button
                type="button"
                className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                onClick={() => showToast('Please contact your administrator for password reset', 'info')}
              >
                Forgot your password?
              </button>
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
