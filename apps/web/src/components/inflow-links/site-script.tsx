'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'

type PageRow = { path: string; views: number; visitors: number }
type TrackingSummary = {
  todayEvents: number
  todayPageViews: number
  linkedEvents: number
  unlinkedEvents: number
  pathCount: number
  eventTypeCount: number
  lastEventAt: string | null
}

export default function SiteScript() {
  const [pages, setPages] = useState<PageRow[]>([])
  const [summary, setSummary] = useState<TrackingSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
  const snippet = `<script src="${apiUrl}/api/site/script.js" async></script>`

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    const [pagesResult, summaryResult] = await Promise.allSettled([
      api.siteTracking.pages(),
      api.siteTracking.summary(),
    ])
    if (pagesResult.status === 'fulfilled' && pagesResult.value.success) {
      setPages(pagesResult.value.data)
    }
    if (summaryResult.status === 'fulfilled' && summaryResult.value.success) {
      setSummary(summaryResult.value.data)
    }
    if (pagesResult.status === 'rejected' && summaryResult.status === 'rejected') {
      setFailed(true)
    }
    setLoading(false)
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
      window.prompt('このコードをコピーしてください:', snippet)
    }
  }

  const receiving = summary?.lastEventAt != null
  const lastSeen = summary?.lastEventAt
    ? summary.lastEventAt.slice(0, 16).replace('T', ' ').replaceAll('-', '/')
    : null

  return (
    <div className="space-y-4" data-design-node="IhSBB">
      <p className="rounded-card bg-info-bg px-4 py-3 text-xs leading-relaxed text-ink-secondary">
        見ているページを数えるためのコードです。サイトに貼ると、どのページを見た人が友だちになったかが分かります。入力フォームの中身など、個人が特定できる情報は送りません。
      </p>

      <section className={`rounded-card border p-4 ${receiving ? 'border-success-bg bg-success-bg' : 'border-hairline bg-canvas'}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className={`text-sm font-semibold ${receiving ? 'text-success' : 'text-ink'}`}>
              {receiving ? `動いています。最後にデータが届いたのは ${lastSeen} です。` : 'まだデータが届いていません。'}
            </p>
            <p className="mt-1 text-xs text-ink-faint">
              {receiving
                ? `今日は ${summary?.todayEvents.toLocaleString('ja-JP')}件、${summary?.pathCount.toLocaleString('ja-JP')}種類のページから届いています。`
                : 'コードを貼ったあと、サイトを1ページ開いてから確かめてください。'}
            </p>
          </div>
          <Button onClick={() => void load()}>いま届いているか確かめる</Button>
        </div>
      </section>

      {failed && (
        <ListState
          kind="error"
          title="サイトの計測状況を表示できませんでした"
          description="計測データは消えていません。通信状態を確認して、もう一度お試しください。"
          action={<Button onClick={() => void load()}>もう一度読み込む</Button>}
        />
      )}

      <section className="rounded-card border border-hairline bg-canvas p-5">
        <h2 className="text-sm font-bold text-ink">サイトに貼るコード</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
          ホームページの <code className="rounded bg-canvas-sunken px-1">&lt;/head&gt;</code> の直前に、この1行をそのまま貼ってください。ページごとに書き換える必要はありません。
        </p>
        <p className="mt-4 text-xs font-semibold text-ink-faint">あなたのアカウントで使うコード</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto rounded-control bg-canvas-sunken px-3 py-2 text-xs text-ink-secondary">{snippet}</code>
          <Button onClick={copy}>{copied ? 'コピーしました' : 'コピー'}</Button>
        </div>
      </section>

      <section className="rounded-card border border-hairline bg-canvas p-5">
        <h2 className="text-sm font-bold text-ink">貼るとできるようになること</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Capability title="どのページを見て来たか" description="友だち追加の直前に見ていたページが、その人の記録に残ります。" />
          <Capability title="どれくらい迷ったか" description="はじめて来てから友だちになるまでの流れを確認できます。" />
          <Capability title="成果を数える" description="サイトから送られた購入や申込のできごとを、成果として数えられます。" />
        </div>
      </section>

      <section className="overflow-hidden rounded-card border border-hairline bg-canvas">
        <div className="border-b border-hairline px-4 py-3">
          <h2 className="text-sm font-bold text-ink">いま届いているページ</h2>
          <p className="mt-1 text-xs text-ink-faint">
            サイト別の許可・停止は、ドメイン管理APIが接続されるとここで操作できます。現在は届いたページの集計を表示します。
          </p>
        </div>
        {loading ? (
          <ListState kind="loading" title="サイトの計測状況を読み込んでいます" />
        ) : pages.length === 0 ? (
          <ListState kind="empty" title="まだ記録がありません" description="コードを貼ったあと、サイトを開くと数分で表示されます。" />
        ) : (
          <table className="w-full table-fixed text-xs">
            <thead className="border-b border-hairline bg-canvas-sunken text-ink-faint">
              <tr>
                <th className="w-[60%] px-4 py-3 text-left font-semibold">ページ</th>
                <th className="w-[20%] px-4 py-3 text-right font-semibold">この30日の表示</th>
                <th className="w-[20%] px-4 py-3 text-right font-semibold">見た人数</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {pages.map((page) => (
                <tr key={page.path}>
                  <td className="truncate px-4 py-3 text-ink" title={page.path}>{page.path}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-secondary">{page.views.toLocaleString('ja-JP')}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-secondary">{page.visitors.toLocaleString('ja-JP')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-card border border-hairline bg-canvas p-5">
        <h2 className="text-sm font-bold text-ink">貼りかたが分からないときは</h2>
        <dl className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Help title="WordPress をお使いなら" description="テーマの header.php か、コードを貼るプラグインへ入れます。" />
          <Help title="Shopify をお使いなら" description="テーマの theme.liquid の </head> の前へ入れます。" />
          <Help title="制作会社にお願いするなら" description="上のコードをそのまま送れば伝わります。書き換えは不要です。" />
        </dl>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-card border border-hairline bg-canvas p-5">
          <h2 className="text-sm font-bold text-ink">どうやって友だちと結びつくか</h2>
          <ol className="mt-3 space-y-2 text-xs leading-relaxed text-ink-secondary">
            <li><strong>1. LINEから開いた場合</strong><br />配信のリンクを踏んだ時点で友だちと結びつきます。</li>
            <li><strong>2. あとからLINEを追加した場合</strong><br />同じブラウザなら、それまでの行動もさかのぼって結びつきます。</li>
            <li><strong>3. 結びつかない場合</strong><br />人数の集計にだけ使い、友だちの記録には付けません。</li>
          </ol>
        </section>
        <section className="rounded-card border border-hairline bg-canvas p-5">
          <h2 className="text-sm font-bold text-ink">気をつけること</h2>
          <ul className="mt-3 space-y-2 text-xs leading-relaxed text-ink-secondary">
            <li>サイト側でCookieの同意を取ってから設置してください。</li>
            <li>入力フォームの中身は送りません。URLのクエリ文字列も保存しません。</li>
            <li>利用目的をプライバシーポリシーに記載してください。</li>
          </ul>
        </section>
      </div>
    </div>
  )
}

function Capability({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-control bg-canvas-sunken p-4">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-faint">{description}</p>
    </div>
  )
}

function Help({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-ink-secondary">{title}</dt>
      <dd className="mt-1 text-xs leading-relaxed text-ink-faint">{description}</dd>
    </div>
  )
}
