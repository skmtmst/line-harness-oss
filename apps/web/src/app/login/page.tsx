'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  clearAdminAccessToken,
  getAdminAccessToken,
  setAdminAccessToken,
} from '@/lib/api'

function extractApiKey(value: string): string {
  const embeddedKey = value.match(/\blh_[a-fA-F0-9]{32}\b/)
  return embeddedKey?.[0] ?? value.trim()
}

export default function LoginPage() {
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const accessToken = getAdminAccessToken()
    if (!accessToken) return

    let cancelled = false
    setLoading(true)
    const restoreSession = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL
        const res = await fetch(`${apiUrl}/api/auth/session`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        if (!res.ok) throw new Error('expired')
        const data = await res.json()
        if (!data?.success || !data?.data) throw new Error('expired')
        if (data.accessToken) setAdminAccessToken(data.accessToken)
        if (data.csrfToken) localStorage.setItem('lh_csrf', data.csrfToken)
        if (data.data.name) localStorage.setItem('lh_staff_name', data.data.name)
        if (data.data.role) localStorage.setItem('lh_staff_role', data.data.role)
        if (!cancelled) router.replace('/')
      } catch {
        clearAdminAccessToken()
        if (!cancelled) setLoading(false)
      }
    }
    void restoreSession()
    return () => { cancelled = true }
  }, [router])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL
      if (!apiUrl) {
        setError('NEXT_PUBLIC_API_URL is not set in build env')
        setLoading(false)
        return
      }
      // Exchange the API key for an HttpOnly cookie and a scoped signed token.
      // The raw API key is never persisted on the device.
      const res = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: extractApiKey(apiKey) }),
      })

      if (res.ok) {
        localStorage.removeItem('lh_api_key')
        try {
          const loginData = await res.json()
          if (loginData.success && loginData.data) {
            localStorage.setItem('lh_staff_name', loginData.data.name)
            localStorage.setItem('lh_staff_role', loginData.data.role)
          }
          if (loginData.accessToken) {
            setAdminAccessToken(loginData.accessToken)
          }
          // Cache the CSRF token for mutating requests (double-submit).
          if (loginData.csrfToken) {
            localStorage.setItem('lh_csrf', loginData.csrfToken)
          }
        } catch {
          // Profile / CSRF caching is best-effort.
        }
        router.push('/')
      } else if (res.status === 401) {
        setError('APIキーが正しくありません')
      } else {
        // Surface topology / configuration errors (e.g. cross-site cookie guard).
        let message = 'ログインに失敗しました'
        try {
          const data = await res.json()
          if (data?.error) message = data.error
        } catch {
          // keep default message
        }
        setError(message)
      }
    } catch {
      setError('接続に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-4 py-[max(1rem,env(safe-area-inset-top))]" style={{ backgroundColor: '#06C755' }}>
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg mx-auto mb-3" style={{ backgroundColor: '#06C755' }}>
            H
          </div>
          <h1 className="text-xl font-bold text-gray-900">L Harness</h1>
          <p className="text-sm text-gray-500 mt-1">管理画面にログイン</p>
        </div>

        <form onSubmit={handleLogin}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData('text')
                const extracted = extractApiKey(pasted)
                if (extracted !== pasted.trim()) {
                  e.preventDefault()
                  setApiKey(extracted)
                }
              }}
              placeholder="APIキーを入力"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              autoComplete="current-password"
              autoFocus
            />
            <p className="mt-1.5 text-xs leading-5 text-gray-500">
              招待文全体を貼り付けてもAPIキーだけを自動で読み取ります
            </p>
          </div>

          {error && (
            <p className="text-sm text-red-600 mb-4">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !apiKey}
            className="w-full py-3 text-white font-medium rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: '#06C755' }}
          >
            {loading ? 'ログイン中...' : 'ログイン'}
          </button>
        </form>
      </div>
    </div>
  )
}
