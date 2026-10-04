'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plug } from 'lucide-react'
import { useAdminTheme } from '@/lib/use-admin-theme'
import { api, type MeasurementSite } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import Disclosure from '@/components/shared/disclosure'
import ListState from '@/components/shared/list-state'
import { TableHeadRow, Th } from '@/components/shared/table'
import Notice from '@/components/shared/notice'
import { TextField, TextArea } from '@/components/shared/text-field'
import { formatDateTime, formatNumber } from '@/lib/format'

type PageRow = { host: string | null; path: string; views: number; visitors: number }
type TrackingSummary = {
  todayEvents: number
  todayPageViews: number
  linkedEvents: number
  unlinkedEvents: number
  pathCount: number
  eventTypeCount: number
  lastEventAt: string | null
  /** #818: 同意した割合と、同意がなくて数えなかった件数 */
  consent?: {
    granted: number
    declined: number
    suppressed: number
    grantedRate: number | null
  }
}

export default function SiteScript() {
  const theme = useAdminTheme()
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
  // #819: 成果を数えるサイト。ドメイン単位の許可と、許可外から届いた数。
  const [sites, setSites] = useState<MeasurementSite[]>([])
  const [sitesFailed, setSitesFailed] = useState(false)
  const [canManage, setCanManage] = useState(false)
  const [siteDialog, setSiteDialog] = useState<
    | { mode: 'create'; label: string; domainsText: string; error: string | null }
    | { mode: 'edit'; site: MeasurementSite; label: string; domainsText: string; error: string | null }
    | null
  >(null)
  const [siteBusy, setSiteBusy] = useState(false)
  // R275: サイトの停止(理由つき)と再開。止めても記録は消えない。
  const [stopDialog, setStopDialog] = useState<
    { site: MeasurementSite; reason: string; error: string | null } | null
  >(null)
  const [resumeTarget, setResumeTarget] = useState<MeasurementSite | null>(null)
  const [siteActionError, setSiteActionError] = useState('')
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
  const snippet = trackingKey
    ? `<script async src="${apiUrl}/api/site/script.js" data-key="${trackingKey}"></script>`
    : null
  /** サイトごとの成果計測つきコード。data-site を足すと許可ドメインの判定が効く。 */
  const siteSnippet = (siteId: string) =>
    trackingKey
      ? `<script async src="${apiUrl}/api/site/script.js" data-key="${trackingKey}" data-site="${siteId}"></script>`
      : null

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    const [pagesResult, summaryResult, sitesResult] = await Promise.allSettled([
      api.siteTracking.pages({ accountId: selectedAccountId ?? undefined }),
      api.siteTracking.summary(selectedAccountId ?? undefined),
      api.measurementSites.list(selectedAccountId ?? undefined),
    ])
    if (pagesResult.status === 'fulfilled' && pagesResult.value.success) {
      setPages(pagesResult.value.data)
    }
    /*
     * 計測状況の正本は集計。集計が読めないときは「未接続」にせず
     * 読み込めなかった表示にする（選んだ値が無視されて400になる事故で、
     * 届いているのに「まだ届いていません」と出ていた）。
     */
    if (summaryResult.status === 'fulfilled' && summaryResult.value.success) {
      setSummary(summaryResult.value.data)
    } else {
      setFailed(true)
    }
    // 計測サイトは別の口。ここだけ失敗してもページ全体の状態を壊さない。
    if (sitesResult.status === 'fulfilled' && sitesResult.value.success && Array.isArray(sitesResult.value.data)) {
      setSites(sitesResult.value.data)
      setSitesFailed(false)
    } else {
      setSitesFailed(true)
    }
    setLoading(false)
  }, [selectedAccountId])

  // サイトの追加・変更は owner/admin だけ。staff は閲覧まで。
  useEffect(() => {
    let active = true
    void api.staff.me().then((response) => {
      if (!active) return
      setCanManage(response.success && (response.data.role === 'owner' || response.data.role === 'admin'))
    }).catch(() => undefined)
    return () => { active = false }
  }, [])

  const parseDomains = (text: string) =>
    text.split(/[\s,]+/).map((d) => d.trim()).filter(Boolean)

  const saveSite = async () => {
    if (!siteDialog) return
    setSiteBusy(true)
    try {
      const domains = parseDomains(siteDialog.domainsText)
      if (siteDialog.mode === 'create') {
        const res = await api.measurementSites.create({
          accountId: selectedAccountId ?? undefined,
          label: siteDialog.label,
          domains,
        })
        if (!res.success) throw new Error(res.error || '作成できませんでした')
      } else {
        const res = await api.measurementSites.update(siteDialog.site.id, {
          label: siteDialog.label,
          domains,
        })
        if (!res.success) throw new Error(res.error || '更新できませんでした')
      }
      setSiteDialog(null)
      await load()
    } catch (err) {
      setSiteDialog({ ...siteDialog, error: err instanceof Error ? err.message : '保存できませんでした' })
    } finally {
      setSiteBusy(false)
    }
  }

  const stopSite = async () => {
    if (!stopDialog) return
    const reason = stopDialog.reason.trim()
    if (!reason) {
      setStopDialog({ ...stopDialog, error: '止める理由を入れてください' })
      return
    }
    setSiteBusy(true)
    try {
      const res = await api.measurementSites.stop(stopDialog.site.id, reason)
      if (!res.success) throw new Error(res.error || '停止できませんでした')
      setStopDialog(null)
      setSiteActionError('')
      await load()
    } catch (err) {
      setStopDialog({ ...stopDialog, error: err instanceof Error ? err.message : '停止できませんでした' })
    } finally {
      setSiteBusy(false)
    }
  }

  const resumeSite = async () => {
    if (!resumeTarget) return
    setSiteBusy(true)
    try {
      const res = await api.measurementSites.resume(resumeTarget.id)
      if (!res.success) throw new Error(res.error || '再開できませんでした')
      setResumeTarget(null)
      setSiteActionError('')
      await load()
    } catch (err) {
      setResumeTarget(null)
      setSiteActionError(err instanceof Error ? err.message : '再開できませんでした')
    } finally {
      setSiteBusy(false)
    }
  }

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
  const lastSeen = formatLastReceived(summary?.lastEventAt)
  // 初回の読み込み中は、未接続とも失敗とも決めつけず読み込み表示にする。
  const showInitialLoading = loading && !failed && summary == null

  const scrollToCode = () => {
    const code = document.getElementById('site-script-code')
    if (code && typeof code.scrollIntoView === 'function') {
      code.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  return (
    <div className="space-y-4" data-design-node="IhSBB">
      <Notice tone="info">
        見ているページを数えるためのコードです。サイトに貼ると、どのページを見た人が友だちになったかが分かります。入力フォームの中身など、個人が特定できる情報は送りません。
      </Notice>

      {showInitialLoading ? (
        <ListState kind="loading" title="サイトの計測状況を読み込んでいます" />
      ) : failed ? (
        <section className="rounded-card border border-hairline bg-canvas p-5" aria-label="サイトの計測を読み込めませんでした">
          <h2 className="text-sm font-bold text-ink">サイトの計測を読み込めませんでした</h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
            {lastSeen ? `最後に受け取ったのは ${lastSeen} です。` : ''}
            タグが外れていないか、サイトの公開先が変わっていないかを確かめてください。
          </p>
          <div className="mt-2">
            <button type="button" onClick={() => void load()} className="text-action text-xs underline">
              もう一度読み込む
            </button>
          </div>
          <Disclosure title="確かめ方を見る" size="compact" className="mt-2">
            <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-ink-secondary">
              <li>タグを貼ったあと、サイトを1ページ開いてから確かめてください。</li>
              <li>テーマの更新などでタグが外れていないか確かめてください。</li>
              <li>サイトの公開先（アドレス）が変わっていないか確かめてください。</li>
            </ul>
          </Disclosure>
        </section>
      ) : receiving ? (
        <section className="rounded-card border border-success-bg bg-success-bg p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-success">
                {`動いています。最後にデータが届いたのは ${lastSeen} です。`}
              </p>
              <p className="mt-1 text-xs text-ink-faint">
                {`今日は ${formatNumber(summary?.todayEvents)}件、${formatNumber(summary?.pathCount)}種類のページから届いています。`}
              </p>
            </div>
            <Button onClick={() => void load()}>いま届いているか確かめる</Button>
          </div>
        </section>
      ) : (
        <section className="rounded-card border border-hairline bg-canvas-sunken p-5" aria-label="サイトの計測は未接続">
          <div className="flex items-start justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
              <Plug aria-hidden="true" className="h-4 w-4 shrink-0" />
              サイトの計測
            </h2>
            <Chip tone="neutral">未接続</Chip>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
            計測用のタグをサイトに入れると、ここに訪問と成果が出ます。数字は出しません（0と書かない）。
          </p>
          <div className="mt-3">
            <Button variant="secondary" onClick={scrollToCode}>つなぎ方を見る</Button>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <section id="site-script-code" className="rounded-card border border-hairline bg-canvas p-5">
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
                {copyFailed && <p className="mt-2 text-xs text-danger">コピーできませんでした。上のコードを選んでコピーしてください。</p>}
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
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-ink">成果を数えるサイト</h2>
                <p className="mt-1 text-xs leading-relaxed text-ink-faint">
                  サイトごとに「ここから届いた成果だけ数える」範囲を決めます。ここに無いドメインから届いた分は成果に数えず、届いた件数と最後の場所だけを残します。
                </p>
              </div>
              {canManage ? (
                <Button
                  variant="secondary"
                  onClick={() => setSiteDialog({ mode: 'create', label: '', domainsText: '', error: null })}
                >
                  サイトを追加する
                </Button>
              ) : null}
            </div>
            {sitesFailed ? (
              <p className="mt-3 text-xs leading-relaxed text-ink-secondary" role="status">
                計測サイトを読み込めませんでした。
                <button type="button" onClick={() => void load()} className="text-action ml-1 underline">
                  もう一度読み込む
                </button>
              </p>
            ) : sites.length === 0 ? (
              <p className="mt-3 text-xs leading-relaxed text-ink-faint">
                まだサイトがありません。追加するとサイトごとの計測コードが出ます。
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {siteActionError ? (
                  <li className="text-xs text-danger" role="alert">{siteActionError}</li>
                ) : null}
                {sites.map((site) => {
                  const stopped = site.stoppedAt != null
                  const code = stopped ? null : siteSnippet(site.id)
                  return (
                    <li key={site.id} className="rounded-control border border-hairline p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-ink" title={site.label}>
                            {site.label}
                            {stopped ? (
                              <Chip tone="warn" className="ml-2">停止中</Chip>
                            ) : null}
                          </p>
                          <p className="mt-0.5 text-xs text-ink-faint">
                            サイトID <code className="break-all">{site.id}</code>
                          </p>
                          {theme === 'v8' && <p className="mt-1 text-xs text-ink-secondary">最後に受け取った時刻: {formatLastReceived(site.lastReceivedAt) ?? 'まだ受け取っていません'}</p>}
                        </div>
                        {canManage ? (
                          <div className="flex gap-2">
                            <Button
                              variant="secondary"
                              onClick={() =>
                                setSiteDialog({
                                  mode: 'edit',
                                  site,
                                  label: site.label,
                                  domainsText: site.domains.join('\n'),
                                  error: null,
                                })
                              }
                            >
                              編集
                            </Button>
                            {stopped ? (
                              <Button variant="secondary" onClick={() => setResumeTarget(site)}>
                                計測を再開する
                              </Button>
                            ) : (
                              <Button
                                variant="secondary"
                                onClick={() => setStopDialog({ site, reason: '', error: null })}
                              >
                                計測を止める
                              </Button>
                            )}
                          </div>
                        ) : null}
                      </div>
                      {stopped ? (
                        <p className="mt-2 text-xs text-status-warn-deep">
                          計測を止めています。このサイトから届く分は数えません。止めたときの記録は残っています。
                          {site.stoppedReason ? `（理由: ${site.stoppedReason}）` : ''}
                        </p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {site.domains.map((host) => (
                          <Chip key={host} tone="neutral">{host}</Chip>
                        ))}
                      </div>
                      {site.rejectedCount > 0 ? (
                        <p className="mt-2 text-xs text-status-warn-deep">
                          許可にない場所から届いた分: {formatNumber(site.rejectedCount)}件
                          {site.lastRejectedHost ? `（最後: ${site.lastRejectedHost}）` : ''}
                        </p>
                      ) : null}
                      {code ? (
                        <div className="mt-2 rounded-control bg-ink p-3">
                          <code className="block overflow-x-auto text-xs text-on-accent">{code}</code>
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section className="rounded-card border border-hairline bg-canvas p-5">
            <h2 className="text-base font-bold text-ink">閲覧の記録への同意</h2>
            <p className="mt-1 text-xs leading-relaxed text-ink-faint">
              計測コードを貼ると、サイトの下に記録の案内が出ます。選ぶまでは閲覧を記録せず、数えなかった分だけここに出します。
            </p>
            <div className="mt-3 rounded-control border border-hairline bg-canvas-sunken p-4" aria-label="サイトに出る案内の見本">
              <p className="text-xs text-ink-secondary">サイトの下に出る案内（見本）</p>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-control bg-canvas p-3 shadow-card">
                <p className="text-xs text-ink">広告の効果を知るため、この端末での閲覧を記録してよいですか？</p>
                <div className="flex gap-2">
                  <span className="rounded-control border border-hairline px-3 py-1.5 text-xs text-ink-secondary">記録しない</span>
                  <span className="rounded-control bg-accent-deep px-3 py-1.5 text-xs font-semibold text-on-accent">記録してよい</span>
                </div>
              </div>
            </div>
            {summary?.consent && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-control border border-hairline p-4">
                  <p className="text-xs text-ink-faint">同意した</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
                    {summary.consent.grantedRate == null ? '—' : `${Math.round(summary.consent.grantedRate * 100)}%`}
                  </p>
                  <p className="mt-1 text-xs text-ink-faint">
                    {formatNumber(summary.consent.granted)}件が記録を許可
                    {summary.consent.declined > 0 ? `・${formatNumber(summary.consent.declined)}件が拒否` : ''}
                  </p>
                </div>
                <div className="rounded-control border border-hairline p-4">
                  <p className="text-xs text-ink-faint">数えなかった</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{formatNumber(summary.consent.suppressed)}件</p>
                  <p className="mt-1 text-xs text-ink-faint">同意がなかったため記録していません</p>
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
              <p className="mt-1 text-xs text-ink-faint">コードを貼ったページの届き具合です。</p>
            </div>
            {loading ? <ListState kind="loading" title="サイトの計測状況を読み込んでいます" /> : pages.length === 0 ? (
              <ListState kind="empty" title="まだ記録がありません" description="コードを貼ったあと、サイトを開くと数分で表示されます。" />
            ) : (
              <table className="w-full table-fixed text-xs">
                <thead className="border-b border-hairline bg-canvas-sunken text-ink-faint"><TableHeadRow><Th>サイト</Th><Th>ページ</Th><Th align="right">この30日のページ表示</Th><Th align="right">友だち追加</Th></TableHeadRow></thead>
                <tbody className="divide-y divide-hairline">
                  {pages.map((page) => {
                    return <tr key={`${page.host ?? ''}:${page.path}`}>
                      <td className="truncate px-4 py-3 text-ink-secondary" title={page.host ?? '以前の記録'}>{page.host ?? '以前の記録'}</td>
                      <td className="truncate px-4 py-3 font-semibold text-ink" title={page.path}>{page.path}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink-secondary">{formatNumber(page.views)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink-secondary">{formatNumber(page.visitors)}人</td>
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
            <ul className="mt-3 space-y-3 text-xs leading-relaxed text-status-warn-deep"><li>個人が特定できる情報は送りません</li></ul>
          </section>
        </aside>
      </div>

      <Dialog
        open={siteDialog !== null}
        title={siteDialog?.mode === 'edit' ? '計測サイトを直す' : '計測サイトを追加'}
        description="このサイトから届いた成果だけを数えます。ドメインは1行に1つずつ書きます（例: shop.example.com）。www の有無は同じサイトとして扱います。"
        busy={siteBusy}
        error={siteDialog?.error ?? undefined}
        confirmLabel={siteDialog?.mode === 'edit' ? '保存する' : '追加する'}
        onConfirm={() => void saveSite()}
        onCancel={() => setSiteDialog(null)}
      >
        {siteDialog ? (
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-semibold text-ink">サイトの名前</span>
              <TextField
                className="mt-1"
                value={siteDialog.label}
                maxLength={100}
                placeholder="例: 公式ショップ"
                onChange={(e) => setSiteDialog({ ...siteDialog, label: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-ink">計測を許可するドメイン</span>
              <TextArea
                className="mt-1"
                rows={4}
                value={siteDialog.domainsText}
                placeholder={'example.com\nshop.example.com'}
                onChange={(e) => setSiteDialog({ ...siteDialog, domainsText: e.target.value })}
              />
            </label>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={stopDialog !== null}
        title="このサイトの計測を止める"
        description="止めるとこのサイトから届く分は成果に数えません。いままで数えた記録は残り、あとから再開できます。止めた理由は履歴に残ります。"
        busy={siteBusy}
        error={stopDialog?.error ?? undefined}
        confirmLabel="計測を止める"
        onConfirm={() => void stopSite()}
        onCancel={() => { if (!siteBusy) setStopDialog(null) }}
      >
        {stopDialog ? (
          <div className="space-y-3">
            <p className="text-xs text-ink-secondary">
              対象: <strong>{stopDialog.site.label}</strong>
            </p>
            <label className="block">
              <span className="text-xs font-semibold text-ink">止める理由（必須）</span>
              <TextField
                className="mt-1"
                value={stopDialog.reason}
                maxLength={200}
                placeholder="例: サイトを閉じたため"
                onChange={(e) => setStopDialog({ ...stopDialog, reason: e.target.value })}
              />
            </label>
          </div>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={resumeTarget !== null}
        title="このサイトの計測を再開する"
        description={resumeTarget ? `「${resumeTarget.label}」から届く分をまた数え始めます。止めていた間の分は数えていません。` : ''}
        confirmLabel="再開する"
        busy={siteBusy}
        onConfirm={() => void resumeSite()}
        onCancel={() => { if (!siteBusy) setResumeTarget(null) }}
      />
    </div>
  )
}

/** 最後に受け取った時刻を「9/26 18:02」の形にする（日本時間）。読めない値は出さない。 */
function formatLastReceived(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return formatDateTime(date)
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
