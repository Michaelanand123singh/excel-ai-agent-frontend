import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom'
import './index.css'
import { ToastProvider } from './contexts/ToastContext'
import ProtectedRoute from './components/auth/ProtectedRoute'
import DashboardLayout from './layouts/DashboardLayout'
import LoginPage from './pages/Login'
import Dashboard from './pages/Dashboard'
import UploadPage from './pages/Upload'
import FilesPage from './pages/Files'
import QueryPage from './pages/Query'
import AnalyticsPage from './pages/Analytics'

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }>
            <Route index element={<Dashboard />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="upload" element={<UploadPage />} />
            <Route path="files" element={<FilesPage />} />
            <Route path="query" element={<QueryPage />} />
            <Route path="bulk-search" element={<Navigate to="/query" replace />} />
            <Route path="analytics" element={<AnalyticsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  )
}
