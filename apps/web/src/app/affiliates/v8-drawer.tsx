'use client'

/*
 * ★V8-B アフィリエイターの明細の引き出し（右から出る480px）。
 * 「成果を見る」で開き、リンク・案件別・友だちの動線・報酬の約束を中で見る。
 *
 * 中身のデータ契約は v7 の行内パネル（tabs.tsx の AffiliatorsTab）と同じ。
 * 世代番号で、別の紹介者へ開き直した途中に届いた古い応答を捨てる（R289）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, X } from 'lucide-react'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import Button from '@/components/shared/button'
import {
  CLICK_SUMMARY_LABEL,
  LINK_CODE_HEADING,
  duplicateFlagHeading,
  duplicateFriendNameText,
  personNameText,
} from './affiliate-display'
import {
  SettlementEditor,
  asReportV2,
  distributionUrl,
  type AffiliateLink,
  type AffiliateListRow,
  type JourneySummary,
  type ReportV2,
} from './tabs'
import styles from './list-v8.module.css'

const JOURNEY_PAGE_SIZE = 30

function formatYen(n: number): string {
  return `¥${formatNumber(Math.round(n))}`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

export default function AffiliateDrawerV8({
  affiliate,
  accountId,
  canEdit,
  startInEdit,
  linkBaseUrl,
  onClose,
  onChanged,
  onStopRequest,
}: {
  affiliate: AffiliateListRow
  accountId: string | null
  canEdit: boolean
  /** 「編集」から開いたとき、報酬の約束の欄を最初から開く。 */
  startInEdit: boolean
  linkBaseUrl: string | null
  onClose: () => void
  onChanged: () => void
  onStopRequest: (id: string, name: string) => void
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [report, setReport] = useState<ReportV2 | null>(null)
  const [links, setLinks] = useState<AffiliateLink[]>([])
  const [journeys, setJourneys] = useState<JourneySummary[]>([])
  const [journeyLoading, setJourneyLoading] = useState(false)
  const [journeyError, setJourneyError] = useState(false)
  const [journeyMore, setJourneyMore] = useState(false)
  const [journeyLoadingMore, setJourneyLoadingMore] = useState(false)
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null)
  const [editing, setEditing] = useState(startInEdit)
  const [settlement, setSettlement] = useState<{ amount: number; conversionCount: number; bankProfileRegistered: boolean } | null>(null)
  const journeyCursorRef = useRef<{ beforeAt: string; beforeId: string } | null>(null)

  // R289: 世代番号。引き出しを開き直したら古い応答を捨てる。
  const genRef = useRef(0)
  const idRef = useRef<string | null>(null)
  const isCurrent = useCallback((id: string, gen: number) => (
    genRef.current === gen && idRef.current === id
  ), [])

  const loadDetail = useCallback(async (id: string, gen: number) => {
    setLoading(true)
    setError(false)
    setReport(null)
    setLinks([])
    setJourneys([])
    setJourneyError(false)
    setJourneyMore(false)
    journeyCursorRef.current = null
    try {
      const [reportRes, linksRes] = await Promise.all([
        api.affiliates.reportV2(id),
        api.affiliates.links(id),
      ])
      if (!isCurrent(id, gen)) return
      // 形を確かめてから入れる。読めない返事を入れると描くときに落ちる。
      setReport(reportRes.success ? asReportV2(reportRes.data) : null)
      if (linksRes.success && Array.isArray(linksRes.data)) setLinks(linksRes.data as unknown as AffiliateLink[])
      if (!reportRes.success || !linksRes.success) setError(true)
    } catch {
      if (!isCurrent(id, gen)) return
      setError(true)
    }
    if (!isCurrent(id, gen)) return
    setLoading(false)
  }, [isCurrent])

  const loadJourneys = useCallback(async (id: string, gen: number) => {
    setJourneyLoading(true)
    setJourneyError(false)
    try {
      const res = await api.affiliates.journeys(id, { limit: JOURNEY_PAGE_SIZE })
      if (!isCurrent(id, gen)) return
      // 口が器（`{items,…}`）を返すことがある。配列でなければ失敗扱い。
      if (res.success && Array.isArray(res.data)) {
        setJourneys(res.data)
        journeyCursorRef.current = res.nextCursor ?? null
        setJourneyMore(Boolean(res.nextCursor))
      } else {
        setJourneyError(true)
      }
    } catch {
      if (!isCurrent(id, gen)) return
      setJourneyError(true)
    }
    if (!isCurrent(id, gen)) return
    setJourneyLoading(false)
  }, [isCurrent])

  const loadMoreJourneys = useCallback(async (id: string, gen: number) => {
    if (journeyLoadingMore) return
    const cursor = journeyCursorRef.current
    if (!cursor) { setJourneyMore(false); return }
    setJourneyLoadingMore(true)
    try {
      const res = await api.affiliates.journeys(id, {
        limit: JOURNEY_PAGE_SIZE,
        beforeAt: cursor.beforeAt,
        beforeId: cursor.beforeId,
      })
      if (!isCurrent(id, gen)) return
      if (res.success && Array.isArray(res.data)) {
        setJourneys((prev) => {
          const seen = new Set(prev.map((j) => j.friendId))
          return [...prev, ...res.data.filter((j) => !seen.has(j.friendId))]
        })
        journeyCursorRef.current = res.nextCursor ?? null
        setJourneyMore(Boolean(res.nextCursor))
        setJourneyError(false)
      } else {
        setJourneyError(true)
      }
    } catch {
      if (!isCurrent(id, gen)) return
      setJourneyError(true)
    }
    setJourneyLoadingMore(false)
  }, [isCurrent, journeyLoadingMore])

  // 「次の支払い」：この人の今回の締め対象（無ければ無いと書く）
  const loadSettlement = useCallback(async (id: string) => {
    if (!accountId) { setSettlement(null); return }
    try {
      const now = new Date()
      const period = {
        periodFrom: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).toISOString(),
        periodTo: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString(),
      }
      const res = await api.affiliates.settlementPreview(accountId, period)
      if (!res.success || !Array.isArray(res.data.affiliates)) { setSettlement(null); return }
      const mine = res.data.affiliates.find((item) => item.affiliateId === id) ?? null
      setSettlement(mine ? {
        amount: mine.amount,
        conversionCount: mine.conversionCount,
        bankProfileRegistered: mine.bankProfileRegistered,
      } : null)
    } catch {
      setSettlement(null)
    }
  }, [accountId])

  useEffect(() => {
    genRef.current += 1
    idRef.current = affiliate.id
    const gen = genRef.current
    void loadDetail(affiliate.id, gen)
    void loadJourneys(affiliate.id, gen)
    void loadSettlement(affiliate.id)
    // Esc / 背面のスクロール
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [affiliate.id, loadDetail, loadJourneys, loadSettlement, onClose])

  const copyLinkUrl = useCallback(async (link: AffiliateLink) => {
    const url = distributionUrl(link.ref_code, linkBaseUrl)
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopiedLinkId(link.id)
      window.setTimeout(() => {
        setCopiedLinkId((current) => (current === link.id ? null : current))
      }, 2000)
    } catch { /* 書けないときはURLが表示のまま */ }
  }, [linkBaseUrl])

  return (
    <>
      <div className={styles.drawerBackdrop} onClick={onClose} aria-hidden="true" />
      <aside
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-label={`${affiliate.name}の成果の詳細`}
        data-design-node="tnTn9"
      >
        <div className={styles.drawerHead}>
          <div>
            <h3 className={styles.drawerTitle}>{affiliate.name}</h3>
            <p className={styles.drawerSub}>
              {affiliate.code}　{affiliate.isActive ? '計測中' : '停止中'}
            </p>
          </div>
          <button
            type="button"
            className={styles.kpiInfoButton}
            style={{ width: 32, height: 32 }}
            aria-label="詳細を閉じる"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className={styles.drawerBody}>
          {loading ? (
            <p style={{ margin: 0, color: 'var(--color-ink-faint)', fontSize: 13 }}>読み込んでいます…</p>
          ) : (
            <>
              {/* 次の支払い */}
              <section className={styles.drawerSection} aria-label="次の支払い">
                <h4 className={styles.drawerSectionTitle}>次の支払い</h4>
                {settlement ? (
                  <div className={styles.drawerKpis}>
                    <div className={styles.drawerKpi}>
                      <p>今回の金額</p>
                      <p>{formatYen(settlement.amount)}</p>
                    </div>
                    <div className={styles.drawerKpi}>
                      <p>成果</p>
                      <p>{formatNumber(settlement.conversionCount)}件</p>
                    </div>
                    <div className={styles.drawerKpi}>
                      <p>振込先</p>
                      <p style={{ color: settlement.bankProfileRegistered ? 'var(--color-success)' : 'var(--color-warning)' }}>
                        {settlement.bankProfileRegistered ? '登録済み' : '未登録'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p style={{ margin: 0, color: 'var(--color-ink-faint)', fontSize: 12 }}>
                    この人には、今回締められる報酬がありません。
                  </p>
                )}
              </section>

              {/* 読めなかったことを0件として描かない */}
              {!report && (
                <section className={styles.drawerSection}>
                  <h4 className={styles.drawerSectionTitle}>この期間の集計を読み込めませんでした</h4>
                  <p style={{ margin: 0, color: 'var(--color-ink-secondary)', fontSize: 12, lineHeight: 1.6 }}>
                    選んだ期間にこの人の成果が1件も無いか、集計が読めませんでした。
                    リンクと成果の記録は消えていません。
                  </p>
                  {error ? (
                    <div>
                      <Button type="button" onClick={() => { void loadDetail(affiliate.id, genRef.current) }}>
                        もう一度読み込む
                      </Button>
                    </div>
                  ) : null}
                </section>
              )}

              {report ? (
                <div className={styles.drawerKpis} style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                  <div className={styles.drawerKpi}>
                    <p>{CLICK_SUMMARY_LABEL}</p>
                    <p>{formatNumber(report.clicks)}</p>
                  </div>
                  <div className={styles.drawerKpi}>
                    <p>友だち追加</p>
                    <p style={{ color: 'var(--color-info)' }}>{formatNumber(report.friendAdds)}</p>
                  </div>
                  <div className={styles.drawerKpi}>
                    <p>成果（却下を除く）</p>
                    <p>{formatNumber(report.conversions)}</p>
                  </div>
                  <div className={styles.drawerKpi} style={{ background: 'var(--color-success-bg)' }}>
                    <p>確定した報酬</p>
                    <p style={{ color: 'var(--color-success)' }}>{formatYen(report.confirmedReward)}</p>
                  </div>
                </div>
              ) : null}

              {report && report.byOffer.length > 0 ? (
                <section className={styles.drawerSection}>
                  <h4 className={styles.drawerSectionTitle}>案件別の内訳</h4>
                  <div className={styles.tableScroll}>
                    <table className={`${styles.table} ${styles.drawerTable}`}>
                      <thead>
                        <tr>
                          <th>案件</th>
                          <th className={styles.numRight}>報酬単価</th>
                          <th className={styles.numRight}>承認済み</th>
                          <th className={styles.numRight}>確定報酬</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.byOffer.map((o) => (
                          <tr key={o.offerId}>
                            <td><span className={styles.cellMain} title={o.offerName}>{o.offerName}</span></td>
                            <td className={styles.numRight}>{formatYen(o.rewardAmount)}</td>
                            <td className={styles.numRight}>{formatNumber(o.conversionsApproved)}</td>
                            <td className={styles.numRight}>{formatYen(o.confirmedReward)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              {report && report.duplicateFlags.length > 0 ? (
                <section className={styles.drawerSection}>
                  <h4 className={styles.drawerSectionTitle} style={{ color: 'var(--color-warning)' }}>
                    {duplicateFlagHeading(report.duplicateFlags.length)}
                  </h4>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {report.duplicateFlags.map((f) => (
                      <span
                        key={f.friendId}
                        className={`${styles.statusBadge} ${styles.statusWarn}`}
                      >
                        {duplicateFriendNameText(f.friendId, journeys)}
                      </span>
                    ))}
                  </div>
                </section>
              ) : null}

              {/* 紹介リンク（コピーは計測を起こさない） */}
              {links.length > 0 ? (
                <section className={styles.drawerSection}>
                  <h4 className={styles.drawerSectionTitle}>紹介リンク（{formatNumber(links.length)}本）</h4>
                  {links.map((link) => {
                    const url = distributionUrl(link.ref_code, linkBaseUrl)
                    return (
                      <div key={link.id} className={styles.linkRow}>
                        <span className={styles.linkUrl} title={url}>{url || link.ref_code}</span>
                        <Button type="button" onClick={() => { void copyLinkUrl(link) }}>
                          <Copy size={13} aria-hidden="true" /> {copiedLinkId === link.id ? 'コピーしました' : 'コピー'}
                        </Button>
                        <span className={`${styles.statusBadge} ${link.is_active ? styles.statusOk : styles.statusNeutral}`}>
                          {link.is_active ? '有効' : '無効'}
                        </span>
                      </div>
                    )
                  })}
                </section>
              ) : null}

              {/* 帰属した友だちの動線 */}
              <section className={styles.drawerSection}>
                <h4 className={styles.drawerSectionTitle}>
                  紹介で増えた友だち（{formatNumber(journeys.length)}人{journeyMore ? 'ほか' : ''}）
                </h4>
                {journeyLoading ? (
                  <p style={{ margin: 0, color: 'var(--color-ink-faint)', fontSize: 13 }}>読み込んでいます…</p>
                ) : journeyError && journeys.length === 0 ? (
                  <div>
                    <p style={{ margin: 0, color: 'var(--color-danger)', fontSize: 13 }}>
                      動線を読み込めませんでした。記録は消えていません。
                    </p>
                    <div style={{ marginTop: 8 }}>
                      <Button type="button" onClick={() => { void loadJourneys(affiliate.id, genRef.current) }}>
                        もう一度読み込む
                      </Button>
                    </div>
                  </div>
                ) : journeys.length === 0 ? (
                  <p style={{ margin: 0, color: 'var(--color-ink-faint)', fontSize: 13 }}>
                    この人の紹介で増えた友だちはまだいません
                  </p>
                ) : (
                  <>
                    <div className={styles.tableScroll}>
                      <table className={`${styles.table} ${styles.drawerTable}`}>
                        <thead>
                          <tr>
                            <th>友だち</th>
                            <th>{LINK_CODE_HEADING}</th>
                            <th className={styles.numRight}>成果</th>
                            <th>追加日</th>
                          </tr>
                        </thead>
                        <tbody>
                          {journeys.map((j) => {
                            const isDup = report?.duplicateFlags.some((f) => f.friendId === j.friendId)
                            return (
                              <tr key={j.friendId} style={isDup ? { background: 'var(--color-status-warn-soft)' } : undefined}>
                                <td>{isDup ? '⚠ ' : ''}{personNameText(j.displayName)}</td>
                                <td style={{ color: 'var(--color-info)', fontFamily: 'monospace', fontSize: 12 }}>{j.refCode ?? '—'}</td>
                                <td className={styles.numRight}>{formatNumber(j.conversionCount)}</td>
                                <td style={{ color: 'var(--color-ink-faint)', fontSize: 12 }}>{formatDate(j.addedAt)}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    {journeyError && !journeyLoadingMore ? (
                      <p style={{ margin: 0, color: 'var(--color-danger)', fontSize: 12 }}>
                        続きを読み込めませんでした。「さらに読み込む」で試し直せます。
                      </p>
                    ) : null}
                    {journeyMore ? (
                      <div>
                        <Button
                          type="button"
                          disabled={journeyLoadingMore}
                          onClick={() => { void loadMoreJourneys(affiliate.id, genRef.current) }}
                        >
                          {journeyLoadingMore ? '読み込み中…' : 'さらに読み込む'}
                        </Button>
                      </div>
                    ) : null}
                  </>
                )}
              </section>

              {/* 報酬の約束（編集モード） */}
              {editing && canEdit ? (
                <section className={styles.drawerSection}>
                  <h4 className={styles.drawerSectionTitle}>報酬の約束</h4>
                  <SettlementEditor
                    affiliate={affiliate}
                    onSaved={() => {
                      setEditing(false)
                      onChanged()
                      void loadDetail(affiliate.id, genRef.current)
                    }}
                  />
                </section>
              ) : null}
            </>
          )}
        </div>

        <div className={styles.drawerFoot}>
          <Button
            type="button"
            variant="danger"
            disabled={!canEdit}
            title={canEdit ? undefined : '閲覧のみのため変更できません'}
            onClick={() => { onClose(); onStopRequest(affiliate.id, affiliate.name) }}
          >
            紹介を止める
          </Button>
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Button type="button" onClick={onClose}>閉じる</Button>
            <Button
              type="button"
              variant="primary"
              disabled={!canEdit}
              title={canEdit ? undefined : '閲覧のみのため変更できません'}
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? '編集を閉じる' : '編集'}
            </Button>
          </span>
        </div>
      </aside>
    </>
  )
}
