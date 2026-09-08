'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ApiError, api, type ApiBroadcast, type BroadcastInsight } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import FlexPreviewComponent from '@/components/flex-preview'
import TestSendSection from '@/components/broadcasts/test-send-section'
import ProgressBar from '@/components/broadcasts/progress-bar'
import SendConfirmDialog from '@/components/broadcasts/send-confirm-dialog'
import SegmentBuilder from '@/components/broadcasts/segment-builder'
import Button from '@/components/shared/button'
import { broadcastCsvFilename } from './broadcast-csv-filename'

interface BroadcastDetailProps {
  broadcastId: string
}

function percentText(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return '—'
  const percentage = rate <= 1 ? rate * 100 : rate
  return `${percentage.toFixed(1)}%`
}

export default function BroadcastDetail({ broadcastId }: BroadcastDetailProps) {
  const id = broadcastId
  const router = useRouter()
  const { selectedAccount, accounts } = useAccount()
  // 別 broadcast に SPA navigation した直後に、前の broadcast の async response が
  // 戻ってきて state を上書きする race を防ぐ。最新の id をここで保持し、.then 内で照合。
  // useEffect だと「新 render 完了 → effect 実行」の間に古い promise が resolve して
  // ref がまだ古い id のまま素通りする race があるため、render 中に同期更新する。
  const latestIdRef = useRef(id)
  latestIdRef.current = id
  const [broadcast, setBroadcast] = useState<ApiBroadcast | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [sending, setSending] = useState(false)
  const [insight, setInsight] = useState<BroadcastInsight | null>(null)
  const [targetCount, setTargetCount] = useState<number | null>(null)
  const [perAccountBreakdown, setPerAccountBreakdown] = useState<Array<{ accountId: string; sendCount: number }> | null>(null)
  const [perAccountStats, setPerAccountStats] = useState<Array<{
    accountId: string;
    accountName: string;
    sent: number;
    uniqueImpression: number | null;
    uniqueClick: number | null;
  }> | null>(null)
  const [showSegmentBuilder, setShowSegmentBuilder] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    // SPA routing で別 broadcast を開いた時に前回の breakdown / per-account stats / insight が
    // 残ると confirm modal や本文に別 broadcast の数値が表示されてしまう。draft データを
    // 取り直す前に全部クリアする。
    setPerAccountBreakdown(null)
    setPerAccountStats(null)
    setInsight(null)
    setTargetCount(null)
    try {
      const res = await api.broadcasts.get(id)
      if (res.success && res.data) {
        setBroadcast(res.data)
        if (res.data.totalCount > 0) {
          setTargetCount(res.data.totalCount)
        } else if (res.data.status === 'draft' || res.data.status === 'scheduled') {
          // draft 中は totalCount=0 のまま。送信前の対象人数を preview-count API で取りに行く。
          // confirm modal の「対象 X人」表示と「送信ボタンの (X人)」表示で使う。
          const requestId = id
          api.broadcasts.previewCount(id).then((r) => {
            // race guard: 古い id の応答は無視する。
            if (requestId !== latestIdRef.current) return
            if (r.success && r.data) {
              setTargetCount(r.data.count)
              if (r.data.perAccount) setPerAccountBreakdown(r.data.perAccount)
            }
          }).catch(() => {/* ignore — fall back to 0 */})
        }
      } else {
        setError('配信が見つかりません')
      }
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  // 送信中は進捗とアカウント別内訳を同じ応答で読む。タブを隠した間は止める。
  useEffect(() => {
    if (broadcast?.status !== 'sending') return
    let interval: ReturnType<typeof setInterval> | null = null
    const poll = async () => {
      const res = await api.broadcasts.getProgress(id)
      if (res.success && res.data) {
        setBroadcast(prev => prev ? {
          ...prev,
          status: res.data.status as ApiBroadcast['status'],
          totalCount: res.data.totalCount,
          successCount: res.data.successCount,
        } : prev)
        setPerAccountStats(res.data.perAccountStats)
        if (res.data.status === 'sent') {
          if (interval) clearInterval(interval)
          interval = null
          load()
        }
      }
    }
    const syncPolling = () => {
      if (document.hidden) {
        if (interval) clearInterval(interval)
        interval = null
        return
      }
      if (!interval) interval = setInterval(() => void poll(), 5000)
    }
    syncPolling()
    document.addEventListener('visibilitychange', syncPolling)
    return () => {
      document.removeEventListener('visibilitychange', syncPolling)
      if (interval) clearInterval(interval)
    }
  }, [broadcast?.status, id, load])

  // Load insight for sent broadcasts
  useEffect(() => {
    if (broadcast?.status !== 'sent') return
    api.broadcasts.getInsight(id).then(res => {
      if (res.success && res.data) setInsight(res.data)
    })
  }, [broadcast?.status, id])

  // Load per-account stats — 送信中 (進捗) + 送信完了 (実績) どちらでも取得する。
  // multi-account-dedup 以外の broadcast でも 1 行返るので最終的にテーブル表示するかは
  // 描画側で targetType チェックして判断する。送信完了時は LINE Insight が
  // each account token で fetch されるので時間かかる (3-5 秒/アカ) — fire-and-forget。
  useEffect(() => {
    const status = broadcast?.status
    if (status !== 'sent') return

    let cancelled = false
    const requestId = id

    const fetchStats = () => {
      api.broadcasts.perAccountStats(requestId).then((r) => {
        // race guard: 別 broadcast に navigate していたら捨てる (response の遅延上書きを防止)
        if (cancelled || requestId !== latestIdRef.current) return
        if (r.success && r.data) setPerAccountStats(r.data)
      }).catch(() => {/* ignore */})
    }

    fetchStats()

    return () => { cancelled = true }
  }, [broadcast?.status, id])

  const handleSend = async () => {
    setShowConfirm(false)
    setSending(true)
    try {
      await api.broadcasts.send(id)
      load()
    } catch (e) {
      // サーバー側は確認ヘッダが無いと 428 を返す。画面の確認手順を経ずに
      // 呼ばれた場合なので、「失敗しました」ではなく理由を出す。
      const status = e instanceof ApiError ? e.status : 0
      setError(
        status === 428
          ? '確認の手順を経ていないため送信できませんでした。もう一度お試しください。'
          : status === 403
            ? 'この操作を行う権限がありません。'
            : '送信に失敗しました',
      )
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return (
      <div>
        <Header title="配信詳細" />
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-canvas-sunken rounded w-64" />
          <div className="h-40 bg-canvas-sunken rounded" />
        </div>
      </div>
    )
  }

  if (!broadcast) {
    return (
      <div>
        <Header title="配信詳細" />
        <p className="text-ink-faint">{error || '配信が見つかりません'}</p>
      </div>
    )
  }

  /* 配信元のアカウント。型が持っているので逃げ道は要らない（#490 軽3）。 */
  const accountId = broadcast.lineAccountId

  if (broadcast.status === 'sent') {
    const delivered = insight?.delivered ?? broadcast.successCount
    const opened = insight?.opens?.count ?? insight?.uniqueImpression ?? null
    const openRate = insight?.opens?.rate ?? insight?.openRate ?? null
    const failed = Math.max(0, broadcast.totalCount - broadcast.successCount)

    const exportCsv = () => {
      const rows = [
        ['項目', '人数', '割合'],
        ['送信成功', String(delivered ?? ''), delivered != null && broadcast.totalCount > 0 ? percentText(delivered / broadcast.totalCount) : ''],
        ['開封', String(opened ?? ''), percentText(openRate)],
        ['クリック', String(insight?.uniqueClick ?? ''), percentText(insight?.clickRate)],
        ['送信失敗', String(failed), broadcast.totalCount > 0 ? percentText(failed / broadcast.totalCount) : ''],
      ]
      const csv = rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(',')).join('\n')
      const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = broadcastCsvFilename(broadcast.title, broadcast.id)
      anchor.click()
      URL.revokeObjectURL(url)
    }

    return (
      <div>
        <Header
          title={`配信結果：${broadcast.title}`}
          action={(
            <div className="flex items-center gap-2">
              <Button href="/broadcasts">一斉配信一覧</Button>
              <Button type="button" onClick={exportCsv}>CSVで書き出す</Button>
            </div>
          )}
        />

        <nav aria-label="配信結果の表示" className="border-hairline mb-5 flex gap-6 border-b text-sm font-semibold">
          {['概要', 'クリック', '友だち', 'エラー', '配信内容'].map((label, index) => (
            <span key={label} className={index === 0 ? 'border-accent text-accent border-b-2 px-1 pb-3' : 'text-ink-secondary px-1 pb-3'}>{label}</span>
          ))}
        </nav>

        <section className="mb-4">
          <h2 className="text-ink text-lg font-bold">配信結果</h2>
          <p className="text-ink-secondary mt-1 text-sm">送信・開封・クリック・ブロックを確認します。</p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {[
              { label: '送信成功', value: delivered, rate: broadcast.totalCount > 0 && delivered != null ? delivered / broadcast.totalCount : null, note: '届いた人' },
              { label: '開封', value: opened, rate: openRate, note: '開いた人' },
              { label: 'クリック', value: insight?.uniqueClick ?? null, rate: insight?.clickRate ?? null, note: '反応した人' },
            ].map((item) => (
              <div key={item.label} className="bg-canvas border-hairline rounded-card border p-4">
                <p className="text-ink-secondary text-xs font-semibold">{item.label}</p>
                <p className="text-ink mt-2 text-2xl font-bold">{percentText(item.rate)}</p>
                <p className="text-ink mt-1 text-sm font-semibold">{item.value == null ? '—' : `${item.value.toLocaleString('ja-JP')}人`}</p>
                <p className="text-ink-faint mt-1 text-xs">{item.note}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-3">
          <div className="space-y-4 xl:col-span-2">
            <section className="bg-canvas border-hairline rounded-card border p-4">
              <h2 className="text-ink text-base font-bold">反応</h2>
              <p className="text-ink-secondary mt-1 text-sm">ボタンとリンクごとの結果です。</p>
              {insight?.links?.length ? (
                <div className="mt-3 divide-y divide-hairline">
                  {insight.links.map((link) => (
                    <div key={link.id} className="flex items-center justify-between gap-4 py-3">
                      <div className="min-w-0">
                        <p className="text-ink truncate text-sm font-semibold" title={link.label}>{link.label}</p>
                        <p className="text-ink-faint truncate text-xs" title={link.url}>{link.url}</p>
                      </div>
                      <p className="text-ink shrink-0 text-sm">クリック {link.uniqueClickCount.toLocaleString('ja-JP')}人（{percentText(link.clickRate)}）</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-ink-faint mt-3 text-sm">計測したボタン・リンクはありません。</p>
              )}
            </section>

            <section className="bg-canvas border-hairline rounded-card border p-4">
              <h2 className="text-ink text-base font-bold">エラー</h2>
              <p className="text-ink-secondary mt-2 text-sm">送信失敗 {failed.toLocaleString('ja-JP')}人</p>
            </section>

            <section className="bg-canvas border-hairline rounded-card border p-4">
              <h2 className="text-ink text-base font-bold">配信した設定</h2>
              <p className="text-ink-secondary mt-1 text-sm">この配信で使った対象と送信方法です。</p>
              <dl className="mt-3 grid gap-3 sm:grid-cols-3">
                <div><dt className="text-ink-faint text-xs">配信済み</dt><dd className="text-ink mt-1 font-bold">{delivered?.toLocaleString('ja-JP') ?? '—'}人</dd></div>
                <div><dt className="text-ink-faint text-xs">開封率</dt><dd className="text-ink mt-1 font-bold">{percentText(openRate)}</dd></div>
                <div><dt className="text-ink-faint text-xs">クリック率</dt><dd className="text-ink mt-1 font-bold">{percentText(insight?.clickRate)}</dd></div>
              </dl>
            </section>
          </div>

          <section className="bg-canvas border-hairline rounded-card border p-4">
            <h2 className="text-ink text-base font-bold">メッセージプレビュー</h2>
            <p className="text-ink-secondary mt-1 text-xs">実際のLINE表示に近い確認用プレビューです。</p>
            <div className="bg-canvas-sunken mt-3 rounded-card p-4">
              <div className="bg-success text-on-accent rounded-2xl rounded-tl-sm px-4 py-3 text-sm whitespace-pre-wrap">{broadcast.messageContent}</div>
              {broadcast.messageOptions?.buttons?.map((button) => (
                <div key={`${button.label}-${button.value}`} className="border-hairline bg-canvas text-action mt-2 truncate rounded-control border px-3 py-2 text-center text-sm font-semibold" title={button.value}>{button.label}</div>
              ))}
            </div>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div>
      <Header
        title={broadcast.title}
        action={
          <button
            onClick={() => router.push('/broadcasts', { scroll: false })}
            className="px-3 py-2 text-sm text-ink-secondary hover:text-ink"
          >
            ← 一覧に戻る
          </button>
        }
      />

      {error && (
        <div className="mb-4 p-3 bg-danger-bg border border-danger-bg rounded-lg text-danger text-sm">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Left: Preview */}
        <div className="bg-canvas rounded-card border border-hairline p-4">
          <h3 className="text-sm font-semibold text-ink-secondary mb-3">メッセージプレビュー</h3>
          {broadcast.messageType === 'flex' ? (
            <FlexPreviewComponent content={broadcast.messageContent} maxWidth={300} />
          ) : broadcast.messageType === 'image' ? (
            (() => {
              try {
                const img = JSON.parse(broadcast.messageContent)
                return <img src={img.originalContentUrl} alt="" className="max-w-[300px] rounded-lg" />
              } catch { return <p className="text-ink-faint text-sm">画像プレビュー不可</p> }
            })()
          ) : (
            <div className="bg-success text-white rounded-2xl rounded-tl-sm px-4 py-3 max-w-[300px] text-sm whitespace-pre-wrap">
              {broadcast.messageContent}
            </div>
          )}
        </div>

        {/* Right: Settings */}
        <div className="bg-canvas rounded-card border border-hairline p-4">
          <h3 className="text-sm font-semibold text-ink-secondary mb-3">配信設定</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-faint">種別</dt>
              <dd className="text-ink">{broadcast.messageType === 'text' ? 'テキスト' : broadcast.messageType === 'image' ? '画像' : 'Flex'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-faint">対象</dt>
              <dd className="text-ink">
                {broadcast.targetType === 'all' ? '全員' : `タグ: ${broadcast.targetTagId ?? '-'}`}
                {targetCount != null && <span className="ml-1 text-ink-faint">({targetCount.toLocaleString('ja-JP')}人)</span>}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-faint">ステータス</dt>
              <dd>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                  broadcast.status === 'draft' ? 'bg-canvas-sunken text-ink-secondary' :
                  broadcast.status === 'scheduled' ? 'bg-info-bg text-info' :
                  broadcast.status === 'sending' ? 'bg-warning-bg text-warning' :
                  'bg-success-bg text-success'
                }`}>
                  {broadcast.status === 'draft' ? '下書き' : broadcast.status === 'scheduled' ? '予約済み' : broadcast.status === 'sending' ? '送信中' : '送信完了'}
                </span>
              </dd>
            </div>
            {broadcast.scheduledAt && (
              <div className="flex justify-between">
                <dt className="text-ink-faint">予約日時</dt>
                <dd className="text-ink">{new Date(broadcast.scheduledAt).toLocaleString('ja-JP')}</dd>
              </div>
            )}
          </dl>
        </div>
      </div>

      {/* Segment Builder */}
      {broadcast.status === 'draft' && (
        <div className="mb-4">
          {!showSegmentBuilder ? (
            <button
              onClick={() => setShowSegmentBuilder(true)}
              className="text-xs text-accent hover:underline"
            >
              セグメント条件を編集
            </button>
          ) : (
            <SegmentBuilder
              initialConditions={broadcast.segmentConditions}
              onApply={async (conditions) => {
                await api.broadcasts.update(id, { segmentConditions: conditions })
                setShowSegmentBuilder(false)
                load()
              }}
              onCancel={() => setShowSegmentBuilder(false)}
            />
          )}
        </div>
      )}

      {/* Link tracking toggle — 送信前 (draft/scheduled) に最終切替できる */}
      {(broadcast.status === 'draft' || broadcast.status === 'scheduled') && (
        <div className="bg-canvas rounded-card border border-hairline p-4 mb-4">
          <label className="flex items-center gap-2 text-sm text-ink-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={broadcast.trackLinks}
              onChange={async (e) => {
                const trackLinks = e.target.checked
                try {
                  await api.broadcasts.update(id, { trackLinks })
                  load()
                } catch { /* keep previous state on failure */ }
              }}
            />
            このメッセージでリンクを短縮する（クリック計測）
          </label>
          <p className="text-xs text-ink-faint mt-1 ml-6">
            OFFにすると本文のURLを計測用リンク（/t/…）に変換せず、そのまま送信します。
          </p>
        </div>
      )}

      {/* Test Send */}
      {broadcast.status === 'draft' && accountId && (
        <div className="mb-4">
          <TestSendSection broadcastId={id} accountId={accountId} disabled={false} />
        </div>
      )}

      {/* Send Progress */}
      {broadcast.status === 'sending' && (
        <div className="mb-4">
          <ProgressBar totalCount={broadcast.totalCount} successCount={broadcast.successCount} />
        </div>
      )}

      {/* Per-account breakdown — 送信中だけ表示。完了後は上のV6結果画面に集約する。 */}
      {broadcast.targetType === 'multi-account-dedup' &&
        broadcast.status === 'sending' &&
        perAccountStats && perAccountStats.length > 0 && (
        <div className="bg-canvas rounded-card border border-hairline p-4 mb-4">
          <h3 className="text-sm font-semibold text-ink-secondary mb-3">アカウント別内訳</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline">
                  <th className="px-2 py-2 text-left text-xs font-medium text-ink-faint">アカウント</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-ink-faint">送信</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-ink-faint">開封</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-ink-faint">クリック</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {perAccountStats.map((row) => {
                  // accounts list から displayName を引く (なければ row.accountName 内部ラベル)
                  const acc = accounts.find((a) => a.id === row.accountId)
                  const label = acc?.displayName ?? acc?.name ?? row.accountName
                  const openRate = row.uniqueImpression != null && row.sent > 0
                    ? (row.uniqueImpression / row.sent) * 100
                    : null
                  const clickRate = row.uniqueClick != null && row.sent > 0
                    ? (row.uniqueClick / row.sent) * 100
                    : null
                  return (
                    <tr key={row.accountId}>
                      <td className="px-2 py-2 text-ink">{label}</td>
                      <td className="px-2 py-2 text-right text-ink">{row.sent.toLocaleString('ja-JP')}</td>
                      <td className="px-2 py-2 text-right">
                        {row.uniqueImpression != null ? (
                          <span className="text-info">
                            {row.uniqueImpression.toLocaleString('ja-JP')}
                            {openRate != null && (
                              <span className="ml-1 text-xs text-ink-faint">({openRate.toFixed(1)}%)</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-ink-faint">-</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {row.uniqueClick != null ? (
                          <span className="text-success">
                            {row.uniqueClick.toLocaleString('ja-JP')}
                            {clickRate != null && (
                              <span className="ml-1 text-xs text-ink-faint">({clickRate.toFixed(1)}%)</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-ink-faint">-</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {/* Totals row */}
                {(() => {
                  const totalSent = perAccountStats.reduce((s, r) => s + r.sent, 0)
                  // 開封・クリックの合計は **送信が発生したアカウントすべてで insight が揃った時** に表示する。
                  // 一部アカが insight 取得失敗 (null のまま) だと、null を 0 として加算してしまい
                  // 「partial を completed として見せる」誤誘導が起きるため、それを避ける。
                  // sent=0 のアカウント (configured but inactive 等) は判定から除外する — そうしないと
                  // 送信ゼロ理由で永遠に insight=null となり合計が「-」のまま固まる。
                  const sentRows = perAccountStats.filter((r) => r.sent > 0)
                  const allHaveImpr = sentRows.length > 0 && sentRows.every((r) => r.uniqueImpression != null)
                  const allHaveClick = sentRows.length > 0 && sentRows.every((r) => r.uniqueClick != null)
                  const totalImpr = allHaveImpr
                    ? perAccountStats.reduce((s, r) => s + (r.uniqueImpression ?? 0), 0)
                    : null
                  const totalClick = allHaveClick
                    ? perAccountStats.reduce((s, r) => s + (r.uniqueClick ?? 0), 0)
                    : null
                  const totalOpenRate = totalImpr != null && totalSent > 0 ? (totalImpr / totalSent) * 100 : null
                  const totalClickRate = totalClick != null && totalSent > 0 ? (totalClick / totalSent) * 100 : null
                  return (
                    <tr className="bg-canvas-sunken font-medium">
                      <td className="px-2 py-2 text-ink">合計</td>
                      <td className="px-2 py-2 text-right text-ink">{totalSent.toLocaleString('ja-JP')}</td>
                      <td className="px-2 py-2 text-right">
                        {totalImpr != null ? (
                          <span className="text-info">
                            {totalImpr.toLocaleString('ja-JP')}
                            {totalOpenRate != null && (
                              <span className="ml-1 text-xs text-ink-faint">({totalOpenRate.toFixed(1)}%)</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-ink-faint">-</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {totalClick != null ? (
                          <span className="text-success">
                            {totalClick.toLocaleString('ja-JP')}
                            {totalClickRate != null && (
                              <span className="ml-1 text-xs text-ink-faint">({totalClickRate.toFixed(1)}%)</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-ink-faint">-</span>
                        )}
                      </td>
                    </tr>
                  )
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Send Button */}
      {broadcast.status === 'draft' && (
        <button
          onClick={() => setShowConfirm(true)}
          disabled={sending}
          className="bg-accent-deep text-on-accent transition-colors hover:brightness-92 w-full rounded-control px-4 py-3 min-h-[44px] text-sm font-medium disabled:opacity-50"
        >
          {sending ? '送信中...' : `この配信を送信する${targetCount != null ? ` (${targetCount.toLocaleString('ja-JP')}人)` : ''}`}
        </button>
      )}

      {/* Confirm Dialog */}
      {showConfirm && (
        <SendConfirmDialog
          title={broadcast.title}
          targetCount={targetCount ?? broadcast.totalCount}
          accountName={selectedAccount?.displayName ?? selectedAccount?.name ?? '-'}
          isMultiAccount={broadcast.targetType === 'multi-account-dedup'}
          perAccount={
            broadcast.targetType === 'multi-account-dedup' && perAccountBreakdown
              ? perAccountBreakdown.map((p) => {
                  const acc = accounts.find((a) => a.id === p.accountId)
                  return {
                    accountId: p.accountId,
                    accountName: acc?.displayName ?? acc?.name ?? p.accountId,
                    sendCount: p.sendCount,
                  }
                })
              : undefined
          }
          onConfirm={handleSend}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  )
}
