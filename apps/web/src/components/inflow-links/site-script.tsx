'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { api, type MeasurementSite } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import SectionHeader from '@/components/shared/section-header'
import PageHeader from '@/components/shared/page-header'
import ActionMenu from '@/components/shared/action-menu'
import { MoreAction } from '@/components/shared/row-actions'
import './site-script-v8.css'
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
  const { selectedAccountId } = useAccount()
  const [pages, setPages] = useState<PageRow[]>([])
  const [dataAccountId, setDataAccountId] = useState(selectedAccountId)
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
  const [siteMenuId, setSiteMenuId] = useState<string | null>(null)
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [pagesFailed, setPagesFailed] = useState(false)
  const loadGeneration = useRef(0)
  const accountRef = useRef(selectedAccountId)
  accountRef.current = selectedAccountId
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
    const generation = ++loadGeneration.current
    const accountAtRequest = selectedAccountId
    if (!accountAtRequest) {
      setPages([])
      setSites([])
      setSummary(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setFailed(false)
    const [pagesResult, summaryResult, sitesResult] = await Promise.allSettled([
      api.siteTracking.pages({ accountId: selectedAccountId ?? undefined }),
      api.siteTracking.summary(selectedAccountId ?? undefined),
      api.measurementSites.list(selectedAccountId ?? undefined),
    ])
    if (generation !== loadGeneration.current || accountAtRequest !== accountRef.current) return
    if (pagesResult.status === 'fulfilled' && pagesResult.value.success) {
      setPages(pagesResult.value.data)
      setPagesFailed(false)
    } else {
      setPages([])
      setPagesFailed(true)
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
    if (!selectedAccountId) { setCanManage(false); return }
    void api.staff.me().then((response) => {
      if (!active) return
      setCanManage(response.success && (response.data.role === 'owner' || response.data.role === 'admin'))
    }).catch(() => undefined)
    return () => { active = false }
  }, [selectedAccountId])

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
    setPages([])
    setSites([])
    setSummary(null)
    setDataAccountId(selectedAccountId)
    setSelectedSiteId(null)
    setSiteMenuId(null)
    setCanManage(false)
    setSiteDialog(null)
    setStopDialog(null)
    setResumeTarget(null)
    void load()
    return () => { loadGeneration.current += 1 }
  }, [load])

  // 選択中アカウントの計測鍵だけを取得する。未選択では通信せず、
  // 切り替え時は前の鍵とコピー状態を消す。取得失敗時はコードを出さない。
  useEffect(() => {
    let cancelled = false
    setTrackingKey(null)
    setCopied(false)
    setCopyFailed(false)
    if (!selectedAccountId) { setKeyLoading(false); return }
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

  const selectedSite = sites.find((site) => site.id === selectedSiteId) ?? null
  const displayedSnippet = selectedSite ? selectedSite.stoppedAt ? null : siteSnippet(selectedSite.id) : snippet
  const copy = async (forAgency = false) => {
    if (!displayedSnippet) return
    try {
      await navigator.clipboard.writeText(forAgency
        ? `ホームページの </head> の直前に、次の計測コードをそのまま貼ってください。ページごとの書き換えは不要です。\n${displayedSnippet}`
        : displayedSnippet)
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

  if (!selectedAccountId) return <ListState kind="empty" title="LINEアカウントを選択してください" />
  if (dataAccountId !== selectedAccountId) return <ListState kind="loading" title="サイトの計測状況を読み込んでいます" />

  return (
    <div className="space-y-4" data-design-node="XjOte" data-inflow-site>
      <PageHeader title="サイトスクリプト" titleDisplay="always"
        breadcrumb={[{ label: '← 流入と計測へ', href: '/inflow-links' }]}
        description="ホームページに1行貼ると、サイトを見た人とLINEの友だちを結びつけ、成果も数えられます。"
        actions={<Button variant="secondary" onClick={() => setHelpOpen(true)}>貼りかたが分からないときは</Button>} />
      <Card padding="default">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionHeader title={`成果を数えるサイト ${loading || sitesFailed ? '—' : formatNumber(sites.length)}`} help="サイトごとにコードを分けます。止めたサイトの成果は数えません。ここにないドメインから届いた分も成果には数えません。" helpLabel="成果を数えるサイトの説明" />
          {canManage ? <Button variant="secondary" onClick={() => setSiteDialog({ mode: 'create', label: '', domainsText: '', error: null })}>サイトを追加する</Button> : null}
        </div>
        {siteActionError ? <Notice tone="warn" message={siteActionError} /> : null}
        {loading ? <ListState kind="loading" title="サイトの計測状況を読み込んでいます" /> : sitesFailed ? failed ? null : <ListState kind="error" title="計測サイトを読み込めませんでした" onRetry={() => void load()} /> : sites.length === 0 ? <ListState kind="empty" title="まだサイトがありません" description="追加するとサイトごとの計測コードが出ます。" /> : (
          <div className="mt-3 overflow-hidden">
            <table className="w-full table-fixed text-xs">
              <colgroup><col /><col className="w-1/4" /><col className="w-28" /><col className="w-28" /><col className="w-14" /></colgroup>
              <thead><TableHeadRow><Th>サイト</Th><Th>ドメイン</Th><Th>状態</Th><Th>最後に届いた</Th><Th align="right">操作</Th></TableHeadRow></thead>
              <tbody className="divide-y divide-hairline">{sites.map((site) => {
                const stopped = site.stoppedAt != null
                return <tr key={site.id}>
                  <td className="px-3 py-3"><span className="block truncate font-semibold text-ink" title={site.label}>{site.label}</span>{stopped && site.stoppedReason ? <span className="block truncate text-ink-secondary" title={site.stoppedReason}>理由: {site.stoppedReason}</span> : null}
                    {site.rejectedCount > 0 ? <p className="text-status-warn-deep">許可にない場所から届いた分: {formatNumber(site.rejectedCount)}件{site.lastRejectedHost ? `（最後: ${site.lastRejectedHost}）` : ''}</p> : null}
                  </td>
                  <td className="truncate px-3 py-3 text-ink-secondary" title={site.domains.join('・')}>{site.domains.join('・') || '—'}</td>
                  <td className="px-3 py-3"><Chip tone={stopped ? 'neutral' : 'ok'}>{stopped ? '停止中' : '計測中'}</Chip></td>
                  <td className="px-3 py-3 text-ink-secondary">—</td>
                  <td className="relative px-3 py-3 text-right">
                    <MoreAction label={`${site.label}の操作`} onClick={() => setSiteMenuId(siteMenuId === site.id ? null : site.id)} />
                    <ActionMenu open={siteMenuId === site.id} onClose={() => setSiteMenuId(null)} ariaLabel={`${site.label}の操作`} items={[
                      { id: 'code', label: 'コードを見る', disabled: stopped, disabledReason: stopped ? '計測を止めています' : undefined, onSelect: () => { setSiteMenuId(null); setSelectedSiteId(site.id); setCopied(false); scrollToCode() } },
                      ...(canManage ? [
                        { id: 'edit', label: '編集', onSelect: () => { setSiteMenuId(null); setSiteDialog({ mode: 'edit', site, label: site.label, domainsText: site.domains.join('\n'), error: null }) } },
                        stopped ? { id: 'resume', label: '計測を再開する', onSelect: () => { setSiteMenuId(null); setResumeTarget(site) } } : { id: 'stop', label: '計測を止める', onSelect: () => { setSiteMenuId(null); setStopDialog({ site, reason: '', error: null }) } },
                      ] : []),
                    ]} />
                  </td>
                </tr>
              })}</tbody>
            </table>
          </div>
        )}
      </Card>
      <div data-inflow-site-columns>
        <div className="min-w-0 space-y-3">
          <Card padding="default" id="site-script-code">
            <SectionHeader title="サイトに貼るコード" note={selectedSite?.label} help="ホームページの </head> の直前に、この1行をそのまま貼ってください。ページごとに書き換える必要はありません。サイトの行の操作から、サイトごとのコードを選べます。" helpLabel="サイトに貼るコードの説明" />
            {keyLoading ? <p className="mt-3 text-xs text-ink-secondary">あなたのアカウントのコードを取得しています…</p> : displayedSnippet ? <>
              <div className="mt-3 overflow-x-auto rounded-control bg-ink p-3 text-on-accent"><code className="whitespace-nowrap text-xs">{displayedSnippet}</code></div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => void copy()}>{copied ? 'コピーしました' : 'コードをコピー'}</Button>
                <Button variant="secondary" onClick={() => void copy(true)}>制作会社へ送る文をコピー</Button>
                {selectedSite ? <Button variant="secondary" onClick={() => { setSelectedSiteId(null); setCopied(false) }}>アカウント共通のコードを見る</Button> : null}
              </div>
              {copyFailed ? <p className="mt-2 text-xs text-ink-secondary" role="status">コピーできませんでした。上のコードを選んでコピーしてください。</p> : null}
            </> : selectedSite?.stoppedAt ? <p className="mt-3 text-xs text-ink-secondary">計測を止めています。このサイトから届く分は数えません。</p> : <div className="mt-3 text-xs text-ink-secondary"><p>計測コードを取得できませんでした。通信状態を確かめて、もう一度お試しください。</p><Button variant="secondary" className="mt-2" onClick={() => setKeyAttempt((n) => n + 1)}>コードをもう一度取得する</Button></div>}
          </Card>
          <Card padding="default">
            <SectionHeader title="計測を許可するドメイン" help="このサイトから届いた成果だけを数えます。1行に1つ。wwwの有無は同じサイトとして扱います。変更はサイトの行の「編集」から行います。" helpLabel="計測を許可するドメインの説明" />
            <TextArea className="mt-3" aria-label="計測を許可するドメイン" readOnly value={(selectedSite ? selectedSite.domains : [...new Set(sites.flatMap((site) => site.domains))]).join('\n')} placeholder="まだドメインがありません" />
          </Card>
          <Card padding="default">
            <SectionHeader title="閲覧の記録への同意（サイトの下に出る案内の見本）" help="選ぶまでは閲覧を記録しません。同意しなかった人は記録せず、数えなかった件数だけ残します。個人が特定できる情報は送りません。" helpLabel="閲覧の記録への同意の説明" />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-control border border-hairline p-3" aria-label="サイトに出る案内の見本">
              <p className="text-xs text-ink">広告の効果を知るため、この端末での閲覧を記録してよいですか？</p>
              <div className="flex gap-2" aria-hidden="true"><span className="rounded-control border border-hairline px-3 py-2 text-xs text-ink-secondary">記録しない</span><span className="rounded-control bg-accent-deep px-3 py-2 text-xs text-on-accent">記録してよい</span></div>
            </div>
            {summary?.consent ? <Disclosure title="同意と数えなかった件数" size="compact" className="mt-3"><p className="text-xs text-ink-secondary">同意した {summary.consent.grantedRate == null ? '—' : `${Math.round(summary.consent.grantedRate * 100)}%`}・{formatNumber(summary.consent.granted)}件が記録を許可・{formatNumber(summary.consent.declined)}件が拒否・数えなかった {formatNumber(summary.consent.suppressed)}件</p></Disclosure> : null}
          </Card>
        </div>
        <aside className="min-w-0 space-y-3">
          <Card padding="default">
            <SectionHeader title="いま届いているか" />
            {showInitialLoading ? <ListState kind="loading" title="サイトの計測状況を読み込んでいます" /> : failed ? <div className="mt-3" aria-label="サイトの計測を読み込めませんでした">
              <p className="text-xs text-ink-secondary">サイトの計測を読み込めませんでした。{lastSeen ? `最後に受け取ったのは ${lastSeen} です。` : ''}</p>
              <Button className="mt-2" variant="secondary" onClick={() => void load()}>もう一度読み込む</Button>
              <Disclosure title="確かめ方を見る" size="compact" className="mt-2"><p className="text-xs text-ink-secondary">タグを貼ったあとサイトを1ページ開き、タグが外れていないか、サイトの公開先が変わっていないか確かめてください。</p></Disclosure>
            </div> : receiving ? <div className="mt-3">
              <Chip tone="ok">届いている</Chip>
              <p className="mt-2 text-xs text-ink-secondary">動いています。最後にデータが届いたのは {lastSeen} です。</p>
              <p className="mt-1 text-xs text-ink-secondary">今日は {formatNumber(summary?.todayEvents)}件、{formatNumber(summary?.pathCount)}種類のページから届いています。</p>
              <Button className="mt-2" variant="secondary" onClick={() => void load()}>いま届いているか確かめる</Button>
            </div> : <div className="mt-3" aria-label="サイトの計測は未接続"><Chip tone="neutral">未接続</Chip><p className="mt-2 text-xs text-ink-secondary">計測用のタグをサイトに入れると、ここに訪問と成果が出ます。受信前は数字は出しません。</p><Button className="mt-2" variant="secondary" onClick={scrollToCode}>つなぎ方を見る</Button></div>}
            <div className="mt-3"><SectionHeader title="いま届いているページ" help="コードを貼ったページの届き具合です。記録は直近30日の集計です。訪問者は同じブラウザを1人として数え、友だち追加の人数とは分けます。" helpLabel="いま届いているページの説明" /></div>
            {loading ? null : failed ? null : pagesFailed ? <ListState kind="error" title="ページの記録を読み込めませんでした" onRetry={() => void load()} /> : pages.length === 0 ? <ListState kind="empty" title="まだ記録がありません" /> : <table className="mt-3 w-full table-fixed text-xs"><colgroup><col /><col className="w-20" /><col className="w-20" /></colgroup><thead><TableHeadRow><Th>ページ</Th><Th align="right">ページ表示</Th><Th align="right">訪問者</Th></TableHeadRow></thead><tbody className="divide-y divide-hairline">{pages.map((page) => <tr key={`${page.host ?? ''}:${page.path}`}><td className="px-3 py-3"><span className="block truncate text-ink" title={page.path}>{page.path}</span><span className="block truncate text-ink-secondary" title={page.host ?? '以前の記録'}>{page.host ?? '以前の記録'}</span></td><td className="px-3 py-3 text-right tabular-nums text-ink-secondary">{formatNumber(page.views)}</td><td className="px-3 py-3 text-right tabular-nums text-ink-secondary">{formatNumber(page.visitors)}人</td></tr>)}</tbody></table>}
          </Card>
          <Card padding="default"><SectionHeader title="どうやって友だちと結びつくか" /><ol className="mt-3 space-y-2 text-xs text-ink-secondary"><li>1. LINEから開いた場合：その場で経路を記録します。</li><li>2. あとからLINEを追加した場合：同じブラウザの記録と結びつけます。</li><li>3. 結びつかない場合：個人を推測せず経路不明として数えます。</li></ol></Card>
          <Card padding="default"><SectionHeader title="つながる先" /><div className="mt-3 flex flex-wrap gap-3 text-xs text-action"><Link href="/conversions">→ コンバージョン</Link><Link href="/analytics">→ 分析</Link><Link href="/friends">→ 友だち</Link><Link href="/inflow-links">→ 流入と計測</Link></div></Card>
        </aside>
      </div>
      <Dialog open={helpOpen} title="貼りかたが分からないときは" confirmLabel="閉じる" onConfirm={() => setHelpOpen(false)} onCancel={() => setHelpOpen(false)}><dl className="space-y-4"><Help title="WordPressをお使いなら" description="テーマのheader.phpか、コードを貼るプラグインに入れます。" /><Help title="Shopifyをお使いなら" description="テーマのtheme.liquidの </head> の前に入れます。" /><Help title="制作会社にお願いするなら" description="「制作会社へ送る文をコピー」で文とコードをコピーして送ってください。書き換えは不要です。" /></dl></Dialog>
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

function Help({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-ink-secondary">{title}</dt>
      <dd className="mt-1 text-xs leading-relaxed text-ink-faint">{description}</dd>
    </div>
  )
}
