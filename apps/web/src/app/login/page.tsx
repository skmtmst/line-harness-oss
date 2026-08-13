'use client'
import { useEffect, useState } from 'react'

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const errorCode = new URLSearchParams(window.location.search).get('error')
    if (errorCode === 'not_authorized') {
      setError('このLINEアカウントには管理者権限がありません。オーナーに追加を依頼してください。')
    } else if (errorCode) {
      setError('LINEログインを完了できませんでした。もう一度お試しください。')
    }
  }, [])

  const handleLogin = () => {
    setLoading(true)
    const apiUrl = process.env.NEXT_PUBLIC_API_URL
    if (!apiUrl) return setLoading(false)
    window.location.assign(`${apiUrl}/api/auth/line`)
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#06C755' }}>
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg mx-auto mb-3" style={{ backgroundColor: '#06C755' }}>
            H
          </div>
          <h1 className="text-xl font-bold text-gray-900">L Harness</h1>
          <p className="text-sm text-gray-500 mt-1">管理画面にログイン</p>
        </div>

        <div>
          {error && (
            <p className="text-sm text-red-600 mb-4">{error}</p>
          )}

          <button
            type="button"
            onClick={handleLogin}
            disabled={loading}
            className="w-full py-3 px-4 text-white font-medium rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-3"
            style={{ backgroundColor: '#06C755' }}
          >
            <span className="w-7 h-7 bg-white rounded-md flex items-center justify-center text-sm font-bold" style={{ color: '#06C755' }}>LINE</span>
            {loading ? 'LINEへ移動中...' : 'LINEでログイン'}
          </button>
          <p className="mt-4 text-xs text-center text-gray-500 leading-relaxed">
            管理者として許可されたLINEアカウントのみログインできます。
          </p>
        </div>
      </div>
    </div>
  )
}
