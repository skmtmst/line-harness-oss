'use client'
import { useEffect, useState } from 'react'
import { useBrand } from '@/lib/use-brand'
import { AUTH_SELECTION_CLEARED_KEY } from '@/lib/hq-navigation'

/** 看板が取れないときに出す名前。 */
const FALLBACK_NAME = '然-NEN- LINE管理システム'

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const brand = useBrand()

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
    sessionStorage.removeItem(AUTH_SELECTION_CLEARED_KEY)
    const apiUrl = process.env.NEXT_PUBLIC_API_URL
    if (!apiUrl) return setLoading(false)
    window.location.assign(`${apiUrl}/api/auth/line`)
  }

  return (
    // 地は沈んだ面。緑ベタの上に白カードを浮かせていたが、設計では
    // 薄いグレーの上に置く。緑はボタンとロゴだけに残す。
    <main className="flex min-h-[100svh] flex-col items-center justify-center bg-canvas-sunken px-4 py-8 sm:px-6 sm:py-12">
      <section className="w-full max-w-lg rounded-card bg-canvas px-6 py-10 shadow-sm sm:px-12">
        <div className="text-center">
          {/* 設定したアイコンを出す。無いときだけ「然」の字に落ちる。
              画像を出す先が公式アカウントなので、alt は名前をそのまま使う。 */}
          {brand.iconUrl ? (
            <img
              src={brand.iconUrl}
              alt={brand.name ?? FALLBACK_NAME}
              className="mx-auto h-16 w-16 rounded-card object-cover"
            />
          ) : (
            <div
              className="mx-auto flex h-16 w-16 items-center justify-center rounded-card bg-accent-soft text-2xl font-bold text-accent"
              aria-hidden="true"
            >
              然
            </div>
          )}
          {/* 公式アカウントの表示名。友だちに見えているのはこちらで、
              DB 側の呼び名（「本番」「テスト」など）ではない。 */}
          <h1 className="mx-auto mt-5 max-w-sm text-xl font-bold leading-snug text-ink">
            {brand.name ?? FALLBACK_NAME}
          </h1>
          <p className="mt-2 text-sm text-ink-secondary">管理画面にログイン</p>
        </div>

        <div className="mt-7">
          {error && (
            <p className="mb-4 rounded-control bg-danger-bg px-4 py-3 text-sm text-danger">{error}</p>
          )}

          <button
            type="button"
            onClick={handleLogin}
            disabled={loading}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-control bg-accent-deep px-4 text-base font-bold text-on-accent transition-colors hover:brightness-92 disabled:opacity-50"
          >
            {/* 白い四角の中に緑のアイコンを入れていたが、設計は白の線画そのまま。 */}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5 shrink-0"
              aria-hidden="true"
            >
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
            </svg>
            <span>{loading ? 'LINEへ移動中…' : 'LINEでログイン'}</span>
          </button>
          <p className="mt-5 text-center text-xs leading-relaxed text-ink-faint">
            管理者または閲覧者として許可された<br className="sm:hidden" />LINEアカウントだけが
            ログインできます。
          </p>
        </div>

        <div className="mt-6 border-t border-hairline pt-6 text-center">
          <p className="text-sm font-bold text-ink">ログインできない場合</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-faint">
            管理者にアカウントの登録を依頼してください。
          </p>
        </div>
      </section>

      {/* 著作表示はカードの中ではなく、カードの外の下。 */}
      <p className="mt-10 text-center text-xs text-ink-faint">© 然-NEN-</p>
    </main>
  )
}
