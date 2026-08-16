'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'

/**
 * サイトスクリプトの案内と、直近の閲覧数。
 *
 * 貼るコードをそのまま出す。手順を文章で説明するより、
 * コピーできる1行がある方が確実に伝わる。
 */
export default function SiteScript() {
  const [pages, setPages] = useState<Array<{ path: string; views: number; visitors: number }>>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  // NEXT_PUBLIC_API_URL はビルド時に埋まる。Worker のURLがそのまま入る。
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
  const snippet = `<script src="${apiUrl}/api/site/script.js" async></script>`

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.siteTracking.pages()
      if (res.success) setPages(res.data)
    } catch {
      // 記録がまだ無い場合もある。表の空欄で伝わる。
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // クリップボードが使えない環境もある。コードは画面に出ている。
    }
  }

  return (
    <div>
      <div className="bg-canvas rounded-card border-hairline mb-5 border p-5">
        <h2 className="text-ink mb-2 text-sm font-semibold">サイトに貼るコード</h2>
        <p className="text-ink-secondary mb-3 text-sm">
          自社サイトの <code className="bg-canvas-sunken rounded px-1">&lt;/body&gt;</code>{' '}
          の直前に貼ると、どのページが見られたかを記録します。
          LIFFやフォームを経由した人は、友だちと結びついて個人の行動として見られるようになります。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="bg-canvas-sunken text-ink-secondary min-w-0 flex-1 overflow-x-auto rounded px-3 py-2 text-xs">
            {snippet}
          </code>
          <button
            onClick={copy}
            className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-3 py-2 text-sm font-medium"
          >
            {copied ? 'コピーしました' : 'コピー'}
          </button>
        </div>

        <details className="mt-4">
          <summary className="text-ink-secondary cursor-pointer text-sm font-medium">
            ボタンのクリックや購入も記録したいとき
          </summary>
          <div className="text-ink-secondary mt-2 space-y-2 text-sm">
            <p>
              押されたことを記録したい要素に{' '}
              <code className="bg-canvas-sunken rounded px-1">
                data-lh-event=&quot;名前&quot;
              </code>{' '}
              を付けます。
            </p>
            <code className="bg-canvas-sunken block overflow-x-auto rounded px-3 py-2 text-xs">
              &lt;button data-lh-event=&quot;資料請求&quot;&gt;資料を請求する&lt;/button&gt;
            </code>
            <p>
              購入完了のように、こちらから知らせたいときは{' '}
              <code className="bg-canvas-sunken rounded px-1">
                lhTrack(&apos;購入&apos;, 5000)
              </code>{' '}
              を呼びます。
            </p>
          </div>
        </details>

        <p className="text-ink-faint mt-4 text-xs leading-relaxed">
          URLのクエリ文字列（<code>?</code> より後ろ）は記録しません。
          メールアドレスなどがURLに入っている場合に、それごと保存してしまわないためです。
        </p>
      </div>

      <div className="bg-canvas rounded-card border-hairline overflow-hidden border">
        <div className="border-hairline border-b px-4 py-3">
          <p className="text-ink text-sm font-semibold">よく見られているページ（直近30日）</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr className="bg-canvas-sunken border-hairline border-b">
                <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold uppercase">
                  ページ
                </th>
                <th className="text-ink-faint px-4 py-3 text-right text-xs font-semibold uppercase">
                  閲覧
                </th>
                <th className="text-ink-faint px-4 py-3 text-right text-xs font-semibold uppercase">
                  人数
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={3} className="text-ink-faint px-4 py-8 text-center text-sm">
                    読み込み中...
                  </td>
                </tr>
              ) : pages.length === 0 ? (
                <tr>
                  <td colSpan={3} className="text-ink-faint px-4 py-8 text-center text-sm">
                    まだ記録がありません。コードを貼ってから数分で出はじめます。
                  </td>
                </tr>
              ) : (
                pages.map((p) => (
                  <tr key={p.path} className="hover:bg-canvas-sunken">
                    <td className="text-ink px-4 py-3 text-sm">{p.path}</td>
                    <td className="text-ink-secondary px-4 py-3 text-right text-sm tabular-nums">
                      {p.views.toLocaleString('ja-JP')}
                    </td>
                    <td className="text-ink-secondary px-4 py-3 text-right text-sm tabular-nums">
                      {p.visitors.toLocaleString('ja-JP')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
