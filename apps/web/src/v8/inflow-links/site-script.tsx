'use client'

/*
 * ★V8 サイトスクリプト（Pencil `XjOte`）。
 *
 * 頭（戻る・題・説明・右下に「貼りかたが分からないときは」）→ 成果を数えるサイトの表（板いっぱい）→
 * 左の列（サイトに貼るコード・計測を許可するドメイン・閲覧の記録への同意）と右の列（いま届いているか・
 * どうやって友だちと結びつくか・つながる先）。
 *
 * 呼ぶ口・権限・失敗の扱いは今のサイトスクリプト（components/inflow-links/site-script-v8.tsx）と同じ
 * （BEHAVIOR.md の「サイトスクリプト」）。違うのは見せ方だけ：
 * - 行の「…」を押すと、表の下の操作の行がそのサイトの「編集・止める・再開する」になる（押せないものは押せない形）
 * - 「貼りかたが分からないときは」は窓で開く（今は右の列のいちばん下の段）
 * - 閲覧のみ（owner・admin 以外）には、サイトを追加する・「…」・操作の行を出さない
 */
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleHelp, Copy, Eye, Mail, MoreHorizontal, Pause, Play, Plus, RefreshCw } from 'lucide-react'
import { ApiError, api, type MeasurementSite } from '@/lib/api'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { formatNumber } from '@/lib/format'
import { useResponseGate } from '@/lib/use-response-gate'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import IconButton from '@/components/shared/icon-button'
import ListState from '@/components/shared/list-state'
import StatusBadge from '@/components/shared/status-badge'
import { TextArea, TextField } from '@/components/shared/text-field'
import { DetailPage } from '@/components/templates'
import { focusField } from './focus-field'
import styles from './site-script.module.css'

type PageRow = { host: string | null; path: string; views: number; visitors: number }
type TrackingSummary = {
  todayEvents: number
  todayPageViews: number
  linkedEvents: number
  unlinkedEvents: number
  pathCount: number
  eventTypeCount: number
  lastEventAt: string | null
}
type SiteDialogState =
  | { mode: 'create'; label: string; domainsText: string; error: string | null }
  | { mode: 'edit'; site: MeasurementSite; label: string; domainsText: string; error: string | null }

/** 「10/1 21:14」の形（日本時間）。読めない値は出さない。 */
function formatShort(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tokyo',
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`
}

const parseDomains = (text: string) => text.split(/[\s,]+/).map((d) => d.trim()).filter(Boolean)

export default function SiteScriptV8() {
  usePageTitle('サイトスクリプト')
  usePageCrumbs([{ label: 'ホーム', href: '/' }, { label: '流入と計測', href: '/inflow-links' }])
  const role = useStaffRole()
  const readonly = role !== null && !canManageRole(role)
  const { selectedAccountId } = useAccount()
  const [pages, setPages] = useState<PageRow[]>([])
  const [summary, setSummary] = useState<TrackingSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [messageCopied, setMessageCopied] = useState(false)
  // アカウント別の計測鍵。取れるまで・取れないときはコードを出さない（固定の鍵を出すと他アカウントの計測が混ざる）。
  const [trackingKey, setTrackingKey] = useState<string | null>(null)
  const [keyLoading, setKeyLoading] = useState(true)
  const [keyAttempt, setKeyAttempt] = useState(0)
  const [sites, setSites] = useState<MeasurementSite[]>([])
  const [sitesFailed, setSitesFailed] = useState(false)
  const [canManage, setCanManage] = useState(false)
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)
  const [siteDialog, setSiteDialog] = useState<SiteDialogState | null>(null)
  const [siteBusy, setSiteBusy] = useState(false)
  const [stopDialog, setStopDialog] = useState<{ site: MeasurementSite; reason: string; error: string | null } | null>(null)
  const [resumeTarget, setResumeTarget] = useState<MeasurementSite | null>(null)
  const [siteActionError, setSiteActionError] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
  const snippet = trackingKey ? `<script async src="${apiUrl}/api/site/script.js" data-key="${trackingKey}"></script>` : null
  const manage = canManage && !readonly

  /*
   * WEB040：アカウントを切り替えたら、前のアカウントのサイト・集計・選択・開いた窓を捨て、
   * 前のアカウントの遅い応答・操作の結果を今の画面へ書かない。
   */
  const gate = useResponseGate()
  const accountRef = useRef(selectedAccountId)
  const previousAccountRef = useRef(selectedAccountId)
  accountRef.current = selectedAccountId
  useEffect(() => {
    if (previousAccountRef.current === selectedAccountId) return
    previousAccountRef.current = selectedAccountId
    setPages([])
    setSummary(null)
    setSites([])
    setSitesFailed(false)
    setSelectedSiteId(null)
    setSiteDialog(null)
    setStopDialog(null)
    setResumeTarget(null)
    setSiteActionError('')
    setSiteBusy(false)
  }, [selectedAccountId])

  const load = useCallback(async () => {
    const token = gate.begin()
    setLoading(true)
    setFailed(false)
    const [pagesResult, summaryResult, sitesResult] = await Promise.allSettled([
      api.siteTracking.pages({ accountId: selectedAccountId ?? undefined }),
      api.siteTracking.summary(selectedAccountId ?? undefined),
      api.measurementSites.list(selectedAccountId ?? undefined),
    ])
    if (!gate.current(token)) return
    if (pagesResult.status === 'fulfilled' && pagesResult.value.success) setPages(pagesResult.value.data)
    if (summaryResult.status === 'fulfilled' && summaryResult.value.success) setSummary(summaryResult.value.data)
    else setFailed(true)
    if (sitesResult.status === 'fulfilled' && sitesResult.value.success && Array.isArray(sitesResult.value.data)) {
      setSites(sitesResult.value.data)
      setSitesFailed(false)
    } else {
      setSitesFailed(true)
    }
    setLoading(false)
  }, [selectedAccountId, gate])

  useEffect(() => {
    let active = true
    void api.staff.me().then((response) => {
      if (!active) return
      setCanManage(response.success && (response.data.role === 'owner' || response.data.role === 'admin'))
    }).catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    let cancelled = false
    setKeyLoading(true)
    void api.siteTracking
      .trackingKey(selectedAccountId ?? undefined)
      .then((res) => {
        if (!cancelled) setTrackingKey(res.success && res.data.trackingKey ? res.data.trackingKey : null)
      })
      .catch(() => {
        if (!cancelled) setTrackingKey(null)
      })
      .finally(() => {
        if (!cancelled) setKeyLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedAccountId, keyAttempt])

  const [siteFieldErrors, setSiteFieldErrors] = useState<Record<string, string>>({})
  const [stopReasonError, setStopReasonError] = useState('')

  const saveSite = async () => {
    if (!siteDialog) return
    const errors: Record<string, string> = {}
    if (!siteDialog.label.trim()) errors['site-name'] = 'サイトの名前を入力してください'
    if (!parseDomains(siteDialog.domainsText).length) errors['site-domains'] = '計測を許可するドメインを入力してください'
    setSiteFieldErrors(errors)
    setSiteDialog({ ...siteDialog, error: null })
    if (Object.keys(errors).length) { focusField(Object.keys(errors)[0]); return }
    const accountAtStart = selectedAccountId
    const moved = () => accountRef.current !== accountAtStart
    setSiteBusy(true)
    try {
      const domains = parseDomains(siteDialog.domainsText)
      if (siteDialog.mode === 'create') {
        const res = await api.measurementSites.create({ accountId: selectedAccountId ?? undefined, label: siteDialog.label, domains })
        if (!res.success) throw new Error(res.error || '作成できませんでした')
      } else {
        const res = await api.measurementSites.update(siteDialog.site.id, { label: siteDialog.label, domains })
        if (!res.success) throw new Error(res.error || '更新できませんでした')
      }
      if (moved()) return
      setSiteDialog(null)
      await load()
    } catch (err) {
      if (moved()) return
      const message = err instanceof Error ? err.message : '保存できませんでした'
      const field = err instanceof ApiError && err.status === 400
        ? message.includes('ドメイン') ? 'site-domains' : message.includes('サイトの名前') ? 'site-name' : null
        : null
      if (field) {
        setSiteFieldErrors({ [field]: message })
        setSiteDialog({ ...siteDialog, error: null })
        focusField(field)
      } else {
        setSiteDialog({ ...siteDialog, error: message })
      }
    } finally {
      setSiteBusy(false)
    }
  }

  const stopSite = async () => {
    if (!stopDialog) return
    const accountAtStart = selectedAccountId
    const moved = () => accountRef.current !== accountAtStart
    const reason = stopDialog.reason.trim()
    if (!reason) {
      setStopDialog({ ...stopDialog, error: null })
      setStopReasonError('止める理由を入れてください')
      focusField('site-stop-reason')
      return
    }
    setSiteBusy(true)
    try {
      const res = await api.measurementSites.stop(stopDialog.site.id, reason)
      if (!res.success) throw new Error(res.error || '停止できませんでした')
      if (moved()) return
      setStopDialog(null)
      setSiteActionError('')
      await load()
    } catch (err) {
      if (moved()) return
      setStopDialog({ ...stopDialog, error: err instanceof Error ? err.message : '停止できませんでした' })
    } finally {
      setSiteBusy(false)
    }
  }

  const resumeSite = async () => {
    if (!resumeTarget) return
    const accountAtStart = selectedAccountId
    const moved = () => accountRef.current !== accountAtStart
    setSiteBusy(true)
    try {
      const res = await api.measurementSites.resume(resumeTarget.id)
      if (!res.success) throw new Error(res.error || '再開できませんでした')
      if (moved()) return
      setResumeTarget(null)
      setSiteActionError('')
      await load()
    } catch (err) {
      if (moved()) return
      setResumeTarget(null)
      setSiteActionError(err instanceof Error ? err.message : '再開できませんでした')
    } finally {
      setSiteBusy(false)
    }
  }

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

  /** 制作会社へ送る文（コードつき）をコピーする。 */
  const copyMessage = async () => {
    if (!snippet) return
    const message = `ホームページの</head>の直前に、この1行をそのまま貼ってください。ページごとに書き換える必要はありません。\n${snippet}`
    try {
      await navigator.clipboard.writeText(message)
      setMessageCopied(true)
      setCopyFailed(false)
      setTimeout(() => setMessageCopied(false), 2000)
    } catch {
      setCopyFailed(true)
    }
  }

  const receiving = summary?.lastEventAt != null
  const lastSeen = formatShort(summary?.lastEventAt)
  const allowedDomains = [...new Set(sites.filter((site) => site.stoppedAt == null).flatMap((site) => site.domains))]
  const selectedSite = sites.find((site) => site.id === selectedSiteId) ?? null
  const selectedStopped = selectedSite?.stoppedAt != null

  const sitesBody = sitesFailed ? (
    <p className={styles.note} role="status">
      計測サイトを読み込めませんでした。
      <button type="button" onClick={() => void load()} className={styles.textLink}>もう一度読み込む</button>
    </p>
  ) : sites.length === 0 ? (
    <p className={styles.note}>まだサイトがありません。追加するとサイトごとの計測コードが出ます。</p>
  ) : (
    <>
      {siteActionError ? <p className={styles.note} role="alert">{siteActionError}</p> : null}
      <div className={styles.siteTable} role="table" aria-label="成果を数えるサイト">
      <div className={styles.siteHead} role="row">
        <span className={styles.colSite} role="columnheader">サイト</span>
        <span className={styles.colDomain} role="columnheader">ドメイン</span>
        <span className={styles.colState} role="columnheader">状態</span>
        <span className={styles.colLast} role="columnheader">最後に届いた</span>
        <span className={styles.colMenu} role="columnheader"><span className="sr-only">操作</span></span>
      </div>
      {sites.map((site) => {
        const stopped = site.stoppedAt != null
        const last = formatShort(site.lastReceivedAt)
        return (
          <div key={site.id} className={styles.siteRow} role="row" data-selected={selectedSiteId === site.id || undefined}>
            <span className={styles.colSite} role="cell"><span className={styles.siteName} title={site.label}>{site.label}</span></span>
            <span className={styles.colDomain} role="cell"><span className={styles.cellText} title={site.domains.join('\n')}>{site.domains.join('、') || '—'}</span></span>
            <span className={styles.colState} role="cell">
              {stopped ? (
                <StatusBadge tone="neutral" size="compact">止めている</StatusBadge>
              ) : (
                <StatusBadge tone="success" size="compact">{site.lastReceivedAt ? '届いている' : '受信待ち'}</StatusBadge>
              )}
            </span>
            <span className={styles.colLast} role="cell"><span className={styles.cellText}>{last ?? '—'}</span></span>
            <span className={styles.colMenu} role="cell">
              {manage ? (
                <IconButton
                  title={`「${site.label}」の操作`}
                  aria-label={`「${site.label}」の操作`}
                  aria-expanded={selectedSiteId === site.id}
                  aria-controls="site-script-row-actions"
                  onClick={() => setSelectedSiteId((current) => (current === site.id ? null : site.id))}
                >
                  <MoreHorizontal size={16} aria-hidden="true" />
                </IconButton>
              ) : null}
            </span>
          </div>
        )
      })}
      </div>
      {manage ? (
        <div className={styles.rowActions} id="site-script-row-actions" role="group" aria-label="選んだサイトの操作">
          <span className={styles.rowActionsLabel}>{selectedSite ? `「${selectedSite.label}」の操作：` : '「…」を開いたとき：'}</span>
          <Button
            disabled={!selectedSite}
            onClick={() => { if (selectedSite) { setSiteFieldErrors({}); setSiteDialog({ mode: 'edit', site: selectedSite, label: selectedSite.label, domainsText: selectedSite.domains.join('\n'), error: null }) } }}
          >
            編集
          </Button>
          <Button disabled={!selectedSite || selectedStopped} onClick={() => { if (selectedSite) { setStopReasonError(''); setStopDialog({ site: selectedSite, reason: '', error: null }) } }}>
            <Pause size={15} aria-hidden="true" />止める
          </Button>
          <Button disabled={!selectedSite || !selectedStopped} onClick={() => selectedSite && setResumeTarget(selectedSite)}>
            <Play size={15} aria-hidden="true" />再開する
          </Button>
        </div>
      ) : null}
    </>
  )

  return (
    <DetailPage boardId="XjOte" title="サイトスクリプト" description="ホームページに1行貼ると、サイトを見た人と LINE の友だちを結びつけ、成果も数えられます。"
      contentPadding="var(--tpl-detail-head-pad-bottom) var(--tpl-head-pad-side)"
      actions={<Button onClick={() => setHelpOpen(true)}><CircleHelp size={15} aria-hidden="true" />貼りかたが分からないときは</Button>}>
      <div className={styles.body}>
        {readonly ? (
          <p className={styles.viewerBand} role="status"><Eye size={16} aria-hidden="true" />閲覧のみで見ています。変える操作は管理者に頼んでください。</p>
        ) : null}

        {loading && summary == null && !failed ? (
          <ListState kind="loading" title="サイトの計測状況を読み込んでいます" />
        ) : failed ? (
          <ListState
            kind="error"
            title="サイトの計測を読み込めませんでした"
            description={`${lastSeen ? `最後に受け取ったのは ${lastSeen} です。` : ''}タグが外れていないか、サイトの公開先が変わっていないかを確かめてください。`}
            action={<Button onClick={() => void load()}>もう一度読み込む</Button>}
          />
        ) : <>
          <section className={styles.card} aria-labelledby="ss-sites">
            <h2 className={styles.cardTitle} id="ss-sites">{`成果を数えるサイト ${sites.length > 0 ? formatNumber(sites.length) : ''}`.trim()}</h2>
            <div className={styles.sitesLead}>
              <p className={styles.lead}>サイトごとにコードを分けます。止めたサイトの成果は数えません。</p>
              {manage ? (
                <Button onClick={() => { setSiteFieldErrors({}); setSiteDialog({ mode: 'create', label: '', domainsText: '', error: null }) }}>
                  <Plus size={15} aria-hidden="true" />サイトを追加する
                </Button>
              ) : null}
            </div>
            {sitesBody}
          </section>

          <div className={styles.split}>
            <div className={styles.column}>
              <section className={styles.panel} aria-labelledby="ss-code">
                <h2 className={styles.cardTitle} id="ss-code">サイトに貼るコード</h2>
                <p className={styles.small}>ホームページの &lt;/head&gt; の直前に、この1行をそのまま貼ってください。ページごとに書き換える必要はありません。</p>
                {keyLoading ? (
                  <p className={styles.small}>あなたのアカウントのコードを取得しています…</p>
                ) : snippet ? (
                  <>
                    <div className={styles.codeBox}><code className={styles.code}>{snippet}</code></div>
                    {copyFailed ? <p className={styles.small} role="alert">コピーできませんでした。上のコードを選んでコピーしてください。</p> : null}
                    <div className={styles.buttons}>
                      <Button variant="primary" onClick={() => void copy()}><Copy size={15} aria-hidden="true" />{copied ? 'コピーしました' : 'コードをコピー'}</Button>
                      <Button onClick={() => void copyMessage()}><Mail size={15} aria-hidden="true" />{messageCopied ? 'コピーしました' : '制作会社へ送る文をコピー'}</Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className={styles.small}>計測コードを読み込めませんでした。アカウントごとの鍵が無いと他の計測と混ざるため、以前の共通の鍵は表示しません。通信状態を確かめて、もう一度お試しください。</p>
                    <div className={styles.buttons}>
                      <Button onClick={() => setKeyAttempt((n) => n + 1)}>コードをもう一度取得する</Button>
                    </div>
                  </>
                )}
              </section>

              <section className={styles.panel} aria-labelledby="ss-domains">
                <h2 className={styles.cardTitle} id="ss-domains">計測を許可するドメイン</h2>
                <div className={styles.domainBox}>
                  {allowedDomains.length > 0
                    ? allowedDomains.map((domain) => <span key={domain} className={styles.domain}>{domain}</span>)
                    : <span className={styles.domainEmpty}>まだ許可したドメインがありません。</span>}
                </div>
                <p className={styles.faint}>このサイトから届いた成果だけを数えます。1行に1つ。www の有無は同じサイトとして扱います。</p>
              </section>

              <section className={styles.panel} aria-labelledby="ss-consent">
                <h2 className={styles.cardTitle} id="ss-consent">閲覧の記録への同意（サイトの下に出る案内の見本）</h2>
                <div className={styles.consent} aria-label="お客さまのサイトに出る案内の見本">
                  <span className={styles.consentText}>広告の効果を知るため、この端末での閲覧を記録してよいですか？</span>
                  <span className={styles.mockButton}>記録しない</span>
                  <span className={`${styles.mockButton} ${styles.mockPrimary}`}>記録してよい</span>
                </div>
                <p className={styles.faint}>同意がなかった人は記録しません（「数えなかった」に入ります）。個人が特定できる情報は送りません。</p>
              </section>
            </div>

            <div className={styles.rail}>
              <section className={styles.panel} aria-labelledby="ss-status">
                <h2 className={styles.cardTitle} id="ss-status">いま届いているか</h2>
                <div className={styles.statusBlock}>
                  {receiving ? (
                    <>
                      <span><StatusBadge tone="success" size="compact">届いている</StatusBadge></span>
                      <p className={styles.faint}>{`最後に届いたのは ${lastSeen ?? '—'}`}</p>
                    </>
                  ) : (
                    <>
                      <span><StatusBadge tone="neutral" size="compact">まだ届いていません</StatusBadge></span>
                      <p className={styles.faint}>コードを貼ったあと、サイトを開くと数分で表示されます。</p>
                    </>
                  )}
                  <span><Button onClick={() => void load()}><RefreshCw size={15} aria-hidden="true" />いま届いているか確かめる</Button></span>
                </div>
                <div className={styles.pageTable} role="table" aria-label="ページごとの表示">
                  <div className={styles.pageHead} role="row">
                    <span className={styles.pageCol} role="columnheader">ページ</span>
                    <span className={styles.numCol} role="columnheader">この30日のページ表示</span>
                    <span className={styles.numColNarrow} role="columnheader">友だち追加</span>
                  </div>
                  {pages.slice(0, 4).map((page) => (
                    <div key={`${page.host ?? ''}:${page.path}`} className={styles.pageRow} role="row">
                      <span className={styles.pageCol} role="cell"><span className={styles.cellSmall} title={page.host ? `${page.host}${page.path}` : page.path}>{page.path}</span></span>
                      <span className={styles.numCol} role="cell">{formatNumber(page.views)}</span>
                      <span className={styles.numColNarrow} role="cell">{formatNumber(page.visitors)}</span>
                    </div>
                  ))}
                  {pages.length === 0 ? (
                    <div className={styles.pageRow} role="row">
                      <span className={styles.pageCol} role="cell">同意なし</span>
                      <span className={styles.numCol} role="cell">—</span>
                      <span className={styles.numColNarrow} role="cell">—</span>
                    </div>
                  ) : null}
                </div>
              </section>

              <section className={styles.panel} aria-labelledby="ss-how">
                <h2 className={styles.cardTitle} id="ss-how">どうやって友だちと結びつくか</h2>
                <p className={styles.small}>1. LINE から開いた場合：その場で経路を記録します。</p>
                <p className={styles.small}>2. あとから LINE を追加した場合：同じブラウザの記録と結びつけます。</p>
                <p className={styles.small}>3. 結びつかない場合：個人を推測せず経路不明として数えます。</p>
              </section>

              <section className={styles.panel} aria-labelledby="ss-links">
                <h2 className={styles.cardTitle} id="ss-links">つながる先</h2>
                <nav className={styles.links} aria-label="つながる先">
                  <Link href="/conversions" className={styles.goLink}>→ コンバージョン</Link>
                  <Link href="/analytics" className={styles.goLink}>→ 分析</Link>
                  <Link href="/friends" className={styles.goLink}>→ 友だち</Link>
                  <Link href="/inflow-links" className={styles.goLink}>→ 流入と計測</Link>
                </nav>
              </section>
            </div>
          </div>
        </>}
      </div>

      <Dialog open={helpOpen} title="貼りかたが分からないときは" onCancel={() => setHelpOpen(false)} cancelLabel="閉じる">
        <dl className={styles.helpList}>
          <div><dt>WordPress をお使いなら</dt><dd>テーマの header.php か、コードを貼るプラグインに入れます</dd></div>
          <div><dt>Shopify をお使いなら</dt><dd>テーマの theme.liquid の &lt;/head&gt; の前に入れます</dd></div>
          <div><dt>制作会社にお願いするなら</dt><dd>このコードをそのまま送れば伝わります。書き換えは不要です（「制作会社へ送る文をコピー」が使えます）</dd></div>
        </dl>
      </Dialog>

      <Dialog
        open={siteDialog !== null}
        initialFocusId={Object.entries(siteFieldErrors).find(([, error]) => Boolean(error))?.[0]}
        title={siteDialog?.mode === 'edit' ? '計測サイトを直す' : '計測サイトを追加'}
        description="このサイトから届いた成果だけを数えます。ドメインは1行に1つずつ書きます（例: shop.example.com）。www の有無は同じサイトとして扱います。"
        busy={siteBusy}
        error={siteDialog?.error ?? undefined}
        confirmLabel={siteDialog?.mode === 'edit' ? '保存する' : '追加する'}
        onConfirm={() => void saveSite()}
        onCancel={() => setSiteDialog(null)}
      >
        {siteDialog ? (
          <div className={styles.dialogFields}>
            <label className={styles.dialogField}>
              <span className={styles.dialogLabel}>サイトの名前</span>
              <TextField id="site-name" aria-invalid={Boolean(siteFieldErrors['site-name'])} aria-describedby={siteFieldErrors['site-name'] ? 'site-name-error' : undefined} value={siteDialog.label} maxLength={100} placeholder="例: 公式ショップ" onChange={(e) => { setSiteDialog({ ...siteDialog, label: e.target.value }); setSiteFieldErrors((old) => ({ ...old, 'site-name': '' })) }} />
              {siteFieldErrors['site-name'] ? <span id="site-name-error" className={styles.fieldError} role="alert">{siteFieldErrors['site-name']}</span> : null}
            </label>
            <label className={styles.dialogField}>
              <span className={styles.dialogLabel}>計測を許可するドメイン</span>
              <TextArea id="site-domains" aria-invalid={Boolean(siteFieldErrors['site-domains'])} aria-describedby={siteFieldErrors['site-domains'] ? 'site-domains-error' : undefined} rows={4} value={siteDialog.domainsText} placeholder={'example.com\nshop.example.com'} onChange={(e) => { setSiteDialog({ ...siteDialog, domainsText: e.target.value }); setSiteFieldErrors((old) => ({ ...old, 'site-domains': '' })) }} />
              {siteFieldErrors['site-domains'] ? <span id="site-domains-error" className={styles.fieldError} role="alert">{siteFieldErrors['site-domains']}</span> : null}
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
          <div className={styles.dialogFields}>
            <p className={styles.small}>{`対象: ${stopDialog.site.label}`}</p>
            <label className={styles.dialogField}>
              <span className={styles.dialogLabel}>止める理由（必須）</span>
              <TextField id="site-stop-reason" aria-invalid={Boolean(stopReasonError)} aria-describedby={stopReasonError ? 'site-stop-reason-error' : undefined} value={stopDialog.reason} maxLength={200} placeholder="例: サイトを閉じたため" onChange={(e) => { setStopDialog({ ...stopDialog, reason: e.target.value }); setStopReasonError('') }} />
              {stopReasonError ? <span id="site-stop-reason-error" className={styles.fieldError} role="alert">{stopReasonError}</span> : null}
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
    </DetailPage>
  )
}
