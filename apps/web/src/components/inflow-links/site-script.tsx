'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { TableHeadRow, Th } from '@/components/shared/table'

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
  const { selectedAccountId } = useAccount()
  const [pages, setPages] = useState<PageRow[]>([])
  const [summary, setSummary] = useState<TrackingSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  // アカウント別の計測鍵。取れるまで・取れないときはコードを出さない
  // (固定の鍵を出すと他アカウントの計測が混ざる)。
  const [trackingKey, setTrackingKey] = useState<string | null>(null)
  const [keyLoading, setKeyLoading] = useState(true)
  const [keyAttempt, setKeyAttempt] = useState(0)
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
  const snippet = trackingKey
    ? `<script async src="${apiUrl}/api/site/script.js" data-key="${trackingKey}"></script>`
    : null

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

  // 選択中アカウントの計測鍵を取る。未選択のときは口に省いて送り、
  // 可視アカウントが1つだけなら向こうで補う。複数ある・失敗のときは
  // コードを出さず案内にする。
  useEffect(() => {
    let cancelled = false
    setKeyLoading(true)
    void api.siteTracking
      .trackingKey(selectedAccountId ?? undefined)
      .then((res) => {
        if (cancelled) return
        setTrackingKey(res.success && res.data.trackingKey ? res.data.trackingKey : null)
      })
      .catch(() => {
        if (cancelled) return
        setTrackingKey(null)
      })
      .finally(() => {
        if (!cancelled) setKeyLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedAccountId, keyAttempt])

  const copy = async () => {
    if (!snippet) return
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      setCopyFailed(false)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopyFailed(true)
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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <section className="rounded-card border border-hairline bg-canvas p-5">
            <h2 className="text-base font-bold text-ink">サイトに貼るコード</h2>
            <p className="mt-1 text-xs leading-relaxed text-ink-faint">ホームページの &lt;/head&gt; の直前に、この1行をそのまま貼ってください。ページごとに書き換える必要はありません。</p>
            {keyLoading ? (
              <p className="mt-3 text-xs text-ink-faint">あなたのアカウントのコードを取得しています…</p>
            ) : snippet ? (
              <>
                <div className="mt-3 rounded-control bg-ink p-4 text-on-accent">
                  <p className="text-xs text-on-accent">あなたのアカウントで使うコード</p>
                  <div className="mt-2 flex items-center gap-3">
                    <code className="min-w-0 flex-1 overflow-x-auto text-xs">{snippet}</code>
                    <Button onClick={copy}>{copied ? 'コピーしました' : 'コピー'}</Button>
                  </div>
                </div>
                {copyFailed && <p className="mt-2 text-xs text-status-danger">コピーできませんでした。上のコードを選んでコピーしてください。</p>}
              </>
            ) : (
              <div className="mt-3 rounded-control bg-canvas-sunken p-4">
                <p className="text-xs leading-relaxed text-ink-secondary">
                  計測コードを取得できませんでした。アカウントごとの鍵が無いと他の計測と混ざるため、以前の共通の鍵は表示しません。通信状態を確かめて、もう一度お試しください。
                </p>
                <div className="mt-2">
                  <Button onClick={() => setKeyAttempt((n) => n + 1)}>コードをもう一度取得する</Button>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-card border border-hairline bg-canvas p-5">
            <h2 className="text-base font-bold text-ink">貼るとできるようになること</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              <Capability title="どのページを見て来たか" description="友だち追加の直前に見ていたページが、その人の記録に残ります。" />
              <Capability title="どれくらい迷ったか" description="はじめて来てから友だちになるまでの日数が分かります。" />
              <Capability title="成果を数える" description="カートに入れた・買った・申し込んだを成果地点として数えられます。" />
            </div>
          </section>

          <section className="overflow-hidden rounded-card border border-hairline bg-canvas">
            <div className="border-b border-hairline px-4 py-3">
              <h2 className="text-base font-bold text-ink">いま届いているページ</h2>
              <p className="mt-1 text-xs text-ink-faint">知らないドメインが並んでいたら、コードが別のサイトにコピーされています。</p>
            </div>
            {loading ? <ListState kind="loading" title="サイトの計測状況を読み込んでいます" /> : pages.length === 0 ? (
              <ListState kind="empty" title="まだ記録がありません" description="コードを貼ったあと、サイトを開くと数分で表示されます。" />
            ) : (
              <table className="w-full table-fixed text-xs">
                <thead className="border-b border-hairline bg-canvas-sunken text-ink-faint"><TableHeadRow><Th>ドメイン</Th><Th align="right">この30日のページ表示</Th><Th align="right">友だち追加</Th><Th>状態</Th></TableHeadRow></thead>
                <tbody className="divide-y divide-hairline">
                  {pages.map((page) => {
                    const domain = (() => { try { return new URL(page.path).hostname } catch { return page.path } })()
                    const unknown = domain.includes('unknown-')
                    return <tr key={page.path} className={unknown ? 'bg-danger-bg' : ''}>
                      <td className={`truncate px-4 py-3 font-semibold ${unknown ? 'text-status-danger' : 'text-ink'}`}>{domain}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink-secondary">{page.views.toLocaleString('ja-JP')}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink-secondary">{page.visitors.toLocaleString('ja-JP')}人</td>
                      <td className={`px-4 py-3 ${unknown ? 'text-status-danger' : 'text-ink-secondary'}`}>{unknown ? '知らないドメインです' : '許可しています'}</td>
                    </tr>
                  })}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-card border border-hairline bg-canvas p-5">
            <h2 className="text-sm font-bold text-ink">貼りかたが分からないときは</h2>
            <dl className="mt-3 space-y-4">
              <Help title="WordPress をお使いなら" description="テーマの header.php か、コードを貼るプラグインに入れます" />
              <Help title="Shopify をお使いなら" description="テーマの theme.liquid の </head> の前に入れます" />
              <Help title="制作会社にお願いするなら" description="このコードをそのまま送れば伝わります。書き換えは不要です" />
            </dl>
          </section>
          <section className="rounded-card border border-hairline bg-canvas p-5">
            <h2 className="text-sm font-bold text-ink">つながる先</h2>
            <ul className="mt-3 space-y-3 text-xs"><li className="text-action">→ 流入と計測</li><li className="text-action">→ コンバージョン</li><li className="text-action">→ 友だち</li><li className="text-action">→ 分析</li></ul>
          </section>
          <section className="rounded-card border border-hairline bg-canvas p-5">
            <h2 className="text-sm font-bold text-ink">どうやって友だちと結びつくか</h2>
            <ol className="mt-3 space-y-2 text-xs text-ink-secondary">
              <li><strong>1. LINEから開いた場合</strong> その場で経路を記録します。</li>
              <li><strong>2. あとからLINEを追加した場合</strong> 同じブラウザの記録と結びつけます。</li>
              <li><strong>3. 結びつかない場合</strong> 個人を推測せず経路不明として数えます。</li>
            </ol>
          </section>
          <section className="rounded-card border border-status-warn bg-status-warn-soft p-5">
            <h2 className="text-sm font-bold text-status-warn-deep">気をつけること</h2>
            <ul className="mt-3 space-y-3 text-xs leading-relaxed text-status-warn-deep"><li>個人が特定できる情報は送りません</li><li>知らないドメインが1つあります</li></ul>
          </section>
        </aside>
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
