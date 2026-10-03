'use client'

/*
 * ★V8-B サイトスクリプト（板 `XjOte`）。
 *
 * v7 のサイトスクリプト（`site-script.tsx`）とは別の見せ方。
 * 取ってくる口・サイトの追加と直し・止めると再開・コードのコピーは
 * v7 と同じ。口に無い所（サイトごとの最後に届いた日時）は作らない。
 * v7 を直す必要が出たら `site-script.tsx` 側も同じ判断を入れる
 * （V8 完成までの二重管理）。
 */
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { api, type MeasurementSite } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import { TextField, TextArea } from '@/components/shared/text-field'
import { RowActions } from '@/components/shared/row-actions'
import { formatDateTime, formatNumber } from '@/lib/format'
import styles from './site-script-v8.module.css'

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

const READONLY_REASON = 'この操作にはオーナーか管理者の権限が要ります'

/** 最後に受け取った時刻を「9/26 18:02」の形にする（日本時間）。読めない値は出さない。 */
function formatLastReceived(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return formatDateTime(date)
}

export default function SiteScriptV8() {
  usePageTitle('サイトスクリプト')
  usePageCrumbs([
    { label: 'ホーム', href: '/' },
    { label: '流入と計測', href: '/inflow-links' },
  ])
  const role = useStaffRole()
  const canEdit = canManageRole(role)
  const { selectedAccountId } = useAccount()
  const [pages, setPages] = useState<PageRow[]>([])
  const [summary, setSummary] = useState<TrackingSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [messageCopied, setMessageCopied] = useState(false)
  const [messageCopyFailed, setMessageCopyFailed] = useState(false)
  // アカウント別の計測鍵。取れるまで・取れないときはコードを出さない
  // (固定の鍵を出すと他アカウントの計測が混ざる)。
  const [trackingKey, setTrackingKey] = useState<string | null>(null)
  const [keyLoading, setKeyLoading] = useState(true)
  const [keyAttempt, setKeyAttempt] = useState(0)
  const [sites, setSites] = useState<MeasurementSite[]>([])
  const [sitesFailed, setSitesFailed] = useState(false)
  const [canManage, setCanManage] = useState(false)
  const [siteDialog, setSiteDialog] = useState<
    | { mode: 'create'; label: string; domainsText: string; error: string | null }
    | { mode: 'edit'; site: MeasurementSite; label: string; domainsText: string; error: string | null }
    | null
  >(null)
  const [siteBusy, setSiteBusy] = useState(false)
  const [stopDialog, setStopDialog] = useState<
    { site: MeasurementSite; reason: string; error: string | null } | null
  >(null)
  const [resumeTarget, setResumeTarget] = useState<MeasurementSite | null>(null)
  const [siteActionError, setSiteActionError] = useState('')
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
  const snippet = trackingKey
    ? `<script async src="${apiUrl}/api/site/script.js" data-key="${trackingKey}"></script>`
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
    if (summaryResult.status === 'fulfilled' && summaryResult.value.success) {
      setSummary(summaryResult.value.data)
    } else {
      setFailed(true)
    }
    if (sitesResult.status === 'fulfilled' && sitesResult.value.success && Array.isArray(sitesResult.value.data)) {
      setSites(sitesResult.value.data)
      setSitesFailed(false)
    } else {
      setSitesFailed(true)
    }
    setLoading(false)
  }, [selectedAccountId])

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

  /** 制作会社へ送る文（コードつき）をコピーする。 */
  const copyMessage = async () => {
    if (!snippet) return
    const message = `ホームページの</head>の直前に、この1行をそのまま貼ってください。ページごとに書き換える必要はありません。\n${snippet}`
    try {
      await navigator.clipboard.writeText(message)
      setMessageCopied(true)
      setMessageCopyFailed(false)
      setTimeout(() => setMessageCopied(false), 2000)
    } catch {
      setMessageCopyFailed(true)
    }
  }

  const receiving = summary?.lastEventAt != null
  const lastSeen = formatLastReceived(summary?.lastEventAt)
  const showInitialLoading = loading && !failed && summary == null
  // 許可ドメインの一覧（動いているサイトの分だけ、重なりなし）。
  const allowedDomains = [...new Set(sites.filter((site) => site.stoppedAt == null).flatMap((site) => site.domains))]

  return (
    <div className={styles.board} data-design-node="XjOte">
      <div className={styles.head}>
        <div className={styles.headText}>
          <p className={styles.headBack}>
            <Link href="/inflow-links" className={styles.headBackLink}>
              ← 流入と計測へ
            </Link>
          </p>
          <h1 className={styles.headTitle}>サイトスクリプト</h1>
          <p className={styles.headDescription}>
            ホームページに1行貼ると、サイトを見た人と LINE の友だちを結びつけ、成果も数えられます。
          </p>
        </div>
        <div className={styles.headActions}>
          <Button variant="secondary" href="#sitescript-v8-help">
            貼りかたが分からないときは
          </Button>
        </div>
      </div>

      {!canEdit ? (
        <Notice tone="info" message="閲覧のみで見ています。変える操作は管理者に頼んでください。" />
      ) : null}

      {showInitialLoading ? (
        <ListState kind="loading" title="サイトの計測状況を読み込んでいます" />
      ) : failed ? (
        <section className={styles.card} aria-label="サイトの計測を読み込めませんでした">
          <h2 className={styles.cardTitle}>サイトの計測を読み込めませんでした</h2>
          <p className={styles.cardNote}>
            {lastSeen ? `最後に受け取ったのは ${lastSeen} です。` : ''}
            タグが外れていないか、サイトの公開先が変わっていないかを確かめてください。
          </p>
          <p className={styles.cardNote}>
            <button type="button" onClick={() => void load()} className={styles.cardLink}>
              もう一度読み込む
            </button>
          </p>
        </section>
      ) : (
        <div className={styles.split}>
          <div className={styles.mainCol}>
            <section className={styles.card} aria-labelledby="ss-v8-sites">
              <div className={styles.cardHead}>
                <div>
                  <h2 className={styles.cardTitle} id="ss-v8-sites">
                    成果を数えるサイト {sites.length > 0 ? formatNumber(sites.length) : ''}
                  </h2>
                  <p className={styles.cardNote}>
                    サイトごとにコードを分けます。止めたサイトの成果は数えません。
                  </p>
                </div>
                {canManage && canEdit ? (
                  <Button
                    variant="secondary"
                    onClick={() => setSiteDialog({ mode: 'create', label: '', domainsText: '', error: null })}
                  >
                    ＋ サイトを追加する
                  </Button>
                ) : null}
              </div>
              {sitesFailed ? (
                <p className={styles.cardNote} role="status">
                  計測サイトを読み込めませんでした。
                  <button type="button" onClick={() => void load()} className={styles.cardLink}>
                    もう一度読み込む
                  </button>
                </p>
              ) : sites.length === 0 ? (
                <p className={styles.cardNote}>
                  まだサイトがありません。追加するとサイトごとの計測コードが出ます。
                </p>
              ) : (
                <>
                  {siteActionError ? (
                    <p className={styles.cardNote} role="alert">
                      {siteActionError}
                    </p>
                  ) : null}
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <colgroup>
                        <col />
                        <col style={{ width: 180 }} />
                        <col style={{ width: 110 }} />
                        <col style={{ width: 56 }} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th scope="col">サイト</th>
                          <th scope="col">ドメイン</th>
                          <th scope="col">状態</th>
                          <th scope="col">
                            <span className="sr-only">操作</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {sites.map((site) => {
                          const stopped = site.stoppedAt != null
                          return (
                            <tr key={site.id}>
                              <td>
                                <span className={styles.cellMain} title={site.label}>
                                  {site.label}
                                </span>
                              </td>
                              <td>
                                <span className={styles.cellEllipsis} title={site.domains.join('\n')}>
                                  {site.domains.join('、') || '—'}
                                </span>
                              </td>
                              <td>
                                {stopped ? (
                                  <span className={`${styles.statePill} ${styles.statePillMuted}`}>
                                    <span className={styles.statePillDot} aria-hidden="true" />
                                    止めている
                                  </span>
                                ) : (
                                  <span className={`${styles.statePill} ${styles.statePillActive}`}>
                                    <span className={styles.statePillDot} aria-hidden="true" />
                                    届いている
                                  </span>
                                )}
                              </td>
                              <td>
                                {canManage && canEdit ? (
                                  <RowActions
                                    menuItems={[
                                      {
                                        id: 'edit',
                                        label: '編集',
                                        onSelect: () =>
                                          setSiteDialog({
                                            mode: 'edit',
                                            site,
                                            label: site.label,
                                            domainsText: site.domains.join('\n'),
                                            error: null,
                                          }),
                                      },
                                      stopped
                                        ? {
                                            id: 'resume',
                                            label: '再開する',
                                            onSelect: () => setResumeTarget(site),
                                          }
                                        : {
                                            id: 'stop',
                                            label: '止める',
                                            onSelect: () =>
                                              setStopDialog({ site, reason: '', error: null }),
                                          },
                                    ]}
                                    subjectName={site.label}
                                  />
                                ) : (
                                  <span className={styles.cellMuted}>—</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className={styles.cardNote}>
                    「…」を開いたとき：編集・止める・再開する。止めたサイトの記録は残ります。
                  </p>
                </>
              )}
            </section>

            <section className={styles.card} aria-labelledby="ss-v8-code">
              <h2 className={styles.cardTitle} id="ss-v8-code">
                サイトに貼るコード
              </h2>
              <p className={styles.cardNote}>
                ホームページの &lt;/head&gt; の直前に、この1行をそのまま貼ってください。ページごとに書き換える必要はありません。
              </p>
              {keyLoading ? (
                <p className={styles.cardNote}>あなたのアカウントのコードを取得しています…</p>
              ) : snippet ? (
                <>
                  <div className={styles.codeBox}>{snippet}</div>
                  {copyFailed ? (
                    <p className={styles.cardNote} role="alert">
                      コピーできませんでした。上のコードを選んでコピーしてください。
                    </p>
                  ) : null}
                  {messageCopyFailed ? (
                    <p className={styles.cardNote} role="alert">
                      コピーできませんでした。上のコードを選んでコピーしてください。
                    </p>
                  ) : null}
                  <div className={styles.codeActions}>
                    <Button variant="primary" onClick={() => void copy()}>
                      {copied ? 'コピーしました' : 'コードをコピー'}
                    </Button>
                    <Button variant="secondary" onClick={() => void copyMessage()}>
                      {messageCopied ? 'コピーしました' : '制作会社へ送る文をコピー'}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className={styles.cardNote}>
                    計測コードを取得できませんでした。アカウントごとの鍵が無いと他の計測と混ざるため、以前の共通の鍵は表示しません。通信状態を確かめて、もう一度お試しください。
                  </p>
                  <div className={styles.codeActions}>
                    <Button onClick={() => setKeyAttempt((n) => n + 1)}>
                      コードをもう一度取得する
                    </Button>
                  </div>
                </>
              )}
              <p className={styles.cardNote}>個人が特定できる情報は送りません。</p>
            </section>

            <section className={styles.card} aria-labelledby="ss-v8-domains">
              <h2 className={styles.cardTitle} id="ss-v8-domains">
                計測を許可するドメイン
              </h2>
              {allowedDomains.length > 0 ? (
                <p className={styles.domainBox}>{allowedDomains.join('\n')}</p>
              ) : (
                <p className={styles.cardNote}>まだ許可したドメインがありません。</p>
              )}
              <p className={styles.cardNote}>
                このサイトから届いた成果だけを数えます。1行に1つ。www の有無は同じサイトとして扱います。
              </p>
            </section>

            <section className={styles.card} aria-labelledby="ss-v8-consent">
              <h2 className={styles.cardTitle} id="ss-v8-consent">
                閲覧の記録への同意（サイトの下に出る案内の見本）
              </h2>
              <div className={styles.consentMock}>
                <div className={styles.consentMockRow}>
                  <span>広告の効果を知るため、この端末での閲覧を記録してよいですか？</span>
                  <span className={styles.consentMockButtons}>
                    <span className={styles.consentMockNo}>記録しない</span>
                    <span className={styles.consentMockYes}>記録してよい</span>
                  </span>
                </div>
              </div>
              <p className={styles.cardNote}>
                同意がなかった人は記録しません（「数えなかった」に入ります）。個人が特定できる情報は送りません。
              </p>
            </section>
          </div>

          <div className={styles.railCol}>
            <section className={styles.card} aria-labelledby="ss-v8-status">
              <h2 className={styles.cardTitle} id="ss-v8-status">
                いま届いているか
              </h2>
              {receiving ? (
                <>
                  <p className={styles.cardNote}>
                    <span className={`${styles.statePill} ${styles.statePillActive}`}>
                      <span className={styles.statePillDot} aria-hidden="true" />
                      届いている
                    </span>
                  </p>
                  <p className={styles.cardNote}>最後に届いたのは {lastSeen} </p>
                  <div className={styles.codeActions}>
                    <Button variant="secondary" onClick={() => void load()}>
                      いま届いているか確かめる
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className={styles.cardNote}>
                    <span className={`${styles.statePill} ${styles.statePillMuted}`}>
                      <span className={styles.statePillDot} aria-hidden="true" />
                      まだ届いていません
                    </span>
                  </p>
                  <p className={styles.cardNote}>
                    コードを貼ったあと、サイトを開くと数分で表示されます。
                  </p>
                </>
              )}
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">ページ</th>
                      <th scope="col" className={styles.numeric}>
                        この30日のページ表示
                      </th>
                      <th scope="col" className={styles.numeric}>
                        友だち追加
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pages.slice(0, 4).map((page) => (
                      <tr key={`${page.host ?? ''}:${page.path}`}>
                        <td>
                          <span className={styles.cellEllipsis} title={page.path}>
                            {page.path}
                          </span>
                        </td>
                        <td className={styles.numeric}>
                          <span className={styles.cellValue}>{formatNumber(page.views)}</span>
                        </td>
                        <td className={styles.numeric}>
                          <span className={styles.cellValue}>{formatNumber(page.visitors)}</span>
                        </td>
                      </tr>
                    ))}
                    {pages.length === 0 ? (
                      <tr>
                        <td>
                          <span className={styles.cellMuted}>同意なし</span>
                        </td>
                        <td className={styles.numeric}>
                          <span className={styles.cellValue}>—</span>
                        </td>
                        <td className={styles.numeric}>
                          <span className={styles.cellValue}>—</span>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>

            <section className={styles.card} aria-labelledby="ss-v8-how">
              <h2 className={styles.cardTitle} id="ss-v8-how">
                どうやって友だちと結びつくか
              </h2>
              <ol className={styles.howList}>
                <li>1. LINE から開いた場合：その場で経路を記録します。</li>
                <li>2. あとから LINE を追加した場合：同じブラウザの記録と結びつけます。</li>
                <li>3. 結びつかない場合：個人を推測せず経路不明として数えます。</li>
              </ol>
            </section>

            <section className={styles.card} aria-labelledby="ss-v8-links">
              <h2 className={styles.cardTitle} id="ss-v8-links">
                つながる先
              </h2>
              <ul className={styles.defList}>
                <li className={styles.defRow}>
                  <Link href="/conversions" className={styles.cardLink}>
                    → コンバージョン
                  </Link>
                </li>
                <li className={styles.defRow}>
                  <Link href="/analytics" className={styles.cardLink}>
                    → 分析
                  </Link>
                </li>
                <li className={styles.defRow}>
                  <Link href="/friends" className={styles.cardLink}>
                    → 友だち
                  </Link>
                </li>
                <li className={styles.defRow}>
                  <Link href="/inflow-links" className={styles.cardLink}>
                    → 流入と計測
                  </Link>
                </li>
              </ul>
            </section>

            <section className={styles.card} id="sitescript-v8-help" aria-labelledby="ss-v8-help">
              <h2 className={styles.cardTitle} id="ss-v8-help">
                貼りかたが分からないときは
              </h2>
              <ul className={styles.defList}>
                <li className={styles.defRow}>
                  <span>
                    WordPress をお使いなら
                    <br />
                    <span className={styles.cellMuted}>
                      テーマの header.php か、コードを貼るプラグインに入れます
                    </span>
                  </span>
                </li>
                <li className={styles.defRow}>
                  <span>
                    Shopify をお使いなら
                    <br />
                    <span className={styles.cellMuted}>
                      テーマの theme.liquid の &lt;/head&gt; の前に入れます
                    </span>
                  </span>
                </li>
                <li className={styles.defRow}>
                  <span>
                    制作会社にお願いするなら
                    <br />
                    <span className={styles.cellMuted}>
                      このコードをそのまま送れば伝わります。書き換えは不要です
                    </span>
                  </span>
                </li>
              </ul>
            </section>
          </div>
        </div>
      )}

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
        onCancel={() => {
          if (!siteBusy) setStopDialog(null)
        }}
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
        description={
          resumeTarget
            ? `「${resumeTarget.label}」から届く分をまた数え始めます。止めていた間の分は数えていません。`
            : ''
        }
        confirmLabel="再開する"
        busy={siteBusy}
        onConfirm={() => void resumeSite()}
        onCancel={() => {
          if (!siteBusy) setResumeTarget(null)
        }}
      />
    </div>
  )
}
