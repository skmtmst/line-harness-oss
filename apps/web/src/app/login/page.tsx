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

  const apiHost = (() => {
    try {
      return new URL(process.env.NEXT_PUBLIC_API_URL ?? '').host
    } catch {
      return ''
    }
  })()

  const handleLogin = () => {
    setLoading(true)
    const apiUrl = process.env.NEXT_PUBLIC_API_URL
    if (!apiUrl) return setLoading(false)
    window.location.assign(`${apiUrl}/api/auth/line`)
  }

  return (
    <main className="min-h-[100svh] bg-accent px-4 py-8 sm:px-6 sm:py-12 flex items-center justify-center">
      <section className="w-full max-w-md rounded-3xl bg-white px-5 py-8 shadow-xl sm:px-10 sm:py-10">
        <div className="mb-7 text-center sm:mb-8">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-xl font-bold text-white shadow-sm" aria-hidden="true">
            N
          </div>
          <h1 className="mx-auto max-w-sm text-xl font-bold leading-snug text-gray-900 sm:text-2xl">
            然-NEN- LINE管理システム
          </h1>
          <p className="mt-2 text-sm text-gray-500 sm:text-base">管理画面にログイン</p>
          {/* 商品名に「TEST」と足していたのをやめ、つなぎ先そのものを出す。
              どの環境に入ろうとしているかは、こちらのほうが確かに分かる。 */}
          {apiHost && (
            <p className="mt-2 text-xs text-gray-400">つなぎ先 {apiHost}</p>
          )}
        </div>

        <div>
          {error && (
            <p className="text-sm text-red-600 mb-4">{error}</p>
          )}

          <button
            type="button"
            onClick={handleLogin}
            disabled={loading}
            className="flex min-h-14 w-full items-center justify-center gap-3 rounded-xl px-4 py-3 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 sm:text-lg"
            style={{ backgroundColor: 'var(--color-accent)' }}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white" aria-hidden="true">
              <svg viewBox="0 0 32 32" className="h-6 w-6 fill-accent">
                <path d="M27.8 14.1c0-5.3-5.3-9.6-11.8-9.6S4.2 8.8 4.2 14.1c0 4.7 4.2 8.7 9.8 9.4.4.1.9.3 1 .7.1.3.1.9 0 1.2l-.2 1.1c-.1.3-.3 1.3 1.1.7 1.4-.6 7.5-4.4 10.2-7.5 1.8-2 1.7-4.1 1.7-5.6Z" />
              </svg>
            </span>
            <span>{loading ? 'LINEへ移動中…' : 'LINEでログイン'}</span>
          </button>
          <p className="mt-5 text-center text-xs leading-relaxed text-gray-500 sm:text-sm">
            管理者または閲覧者として許可された<br className="sm:hidden" />LINEアカウントだけが
            ログインできます。
          </p>
        </div>

        <div className="mt-7 border-t border-gray-100 pt-5 text-center">
          <p className="text-sm font-medium text-gray-700">ログインできない場合</p>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">
            管理者にアカウントの登録を依頼してください。
          </p>
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">© 然-NEN-</p>
      </section>
    </main>
  )
}
