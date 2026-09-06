'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ApiError, api, type ApiBroadcast, type BroadcastInsight } from '@/lib/api'
import Header from '@/components/layout/header'
import Button from '@/components/shared/button'
import { useAccount } from '@/contexts/account-context'
import { messageTypeLabel } from '@/lib/broadcast-summary'
import { broadcastBelongsToSelectedAccount } from './broadcast-detail-account'
import { clickInsightDetail, formatBroadcastDateTime, openInsightDetail } from './broadcast-insight-display'
import { broadcastDetailCsv } from './broadcast-detail-export'
import { usePageTitle } from '@/components/shell/page-chrome'

const STATUS_LABELS: Record<string, string> = {
  draft: '下書き',
  scheduled: '予約済み',
  sending: '送信中',
  sent: '送信済み',
}

function BroadcastDetailInner() {
  const params = useSearchParams()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const id = params.get('id') ?? ''
  const [broadcast, setBroadcast] = useState<ApiBroadcast | null>(null)
  const [insight, setInsight] = useState<(BroadcastInsight & { suppressedByAudienceSize: boolean }) | null>(null)
  // 集計は配信本体とは別に取る。取れていないのか、取りに行って失敗したのかを
  // 「—」に混ぜると、待てば出るのか操作が要るのかを運用者が判断できない。
  const [insightState, setInsightState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'not-found' | 'error'>('loading')
  const [reloadToken, setReloadToken] = useState(0)
  const contentRef = useRef<HTMLElement>(null)

  const exportCsv = () => {
    if (!broadcast) return
    const csv = broadcastDetailCsv({
      title: broadcast.title,
      status: broadcast.status,
      sentAt: broadcast.sentAt,
      scheduledAt: broadcast.scheduledAt,
      totalCount: broadcast.totalCount,
      successCount: broadcast.successCount,
      delivered: insight?.delivered ?? null,
      uniqueImpression: insight?.uniqueImpression ?? null,
      uniqueClick: insight?.uniqueClick ?? null,
    }, formatBroadcastDateTime)
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `broadcast-${broadcast.id}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    let active = true
    setBroadcast(null)
    setInsight(null)
    setInsightState('loading')
    setLoadState('loading')
    if (!id || accountLoading) {
      return
    }
    if (!selectedAccountId) {
      setLoadState('not-found')
      return
    }
    void (async () => {
      try {
        const detail = await api.broadcasts.get(id)
        if (!active) return
        if (!detail.success || !broadcastBelongsToSelectedAccount(detail.data, selectedAccountId)) {
          setLoadState('not-found')
          return
        }

        setBroadcast(detail.data)
        setLoadState('ready')

        // 詳細画面は送信日が30日より前でも開く。期間集計ではなく、
        // この配信自身の保存済みインサイトを読む。
        try {
          const stats = await api.broadcasts.getInsight(id)
          if (!active) return
          if (stats.success && stats.data) {
            setInsight({
              ...stats.data,
              suppressedByAudienceSize:
                stats.data.uniqueImpression == null
                && (stats.data.delivered ?? 0) > 0
                && (stats.data.delivered ?? 0) < 20,
            })
            setInsightState('ready')
          } else if (stats.success) {
            // 200 で data が null。まだLINEから集計が返っていない。
            setInsightState('ready')
          } else {
            setInsightState('error')
          }
        } catch {
          // 配信本体は読めている。集計だけ落ちたことを、未取得と分けて出す。
          if (active) setInsightState('error')
        }
      } catch (error) {
        if (!active) return
        setLoadState(error instanceof ApiError && error.status === 404 ? 'not-found' : 'error')
      }
    })()
    return () => {
      active = false
    }
  }, [accountLoading, id, reloadToken, selectedAccountId])

  if (!id) {
    return (
      <div>
        <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
          配信が指定されていません。
          <Link href="/broadcasts" className="text-accent ml-1 hover:underline">
            一覧へ戻る
          </Link>
        </p>
      </div>
    )
  }

  const total = broadcast?.totalCount ?? 0
  const success = broadcast?.successCount ?? 0
  const failed = Math.max(0, total - success)
  const pct = (n: number, base: number) =>
    base > 0 ? `${Math.round((n / base) * 1000) / 10}%` : '—'

  return (
    <div>
      <nav data-design="Crumb" className="text-ink-faint mb-2 text-xs">
        <Link href="/broadcasts" className="hover:underline">
          一斉配信
        </Link>
        <span className="mx-1.5">/</span>
        <span>{broadcast?.title ?? '詳細'}</span>
      </nav>

      <div data-design="Head">
        <Header
          title={broadcast ? `配信結果：${broadcast.title}` : '配信の詳細'}
          description={
            broadcast?.sentAt
              ? `${formatBroadcastDateTime(broadcast.sentAt)} に送信`
              : broadcast?.scheduledAt
                ? `${formatBroadcastDateTime(broadcast.scheduledAt)} に予約`
                : undefined
          }
          action={
            <div className="flex flex-wrap gap-2">
              <Button onClick={exportCsv} disabled={!broadcast}>
                CSVで書き出す
              </Button>
            </div>
          }
        />
      </div>

      {loadState === 'loading' ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : loadState === 'error' ? (
        <div className="bg-canvas rounded-card border-hairline border p-8 text-center">
          <p className="text-ink text-sm font-semibold">配信を読み込めませんでした</p>
          <p className="text-ink-faint mt-1 text-xs">通信状態を確認して、もう一度お試しください。</p>
          <Button className="mt-4" onClick={() => setReloadToken((value) => value + 1)}>
            配信を再読み込み
          </Button>
        </div>
      ) : loadState === 'not-found' || !broadcast ? (
        <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
          このLINEアカウントで確認できる配信は見つかりませんでした。
        </p>
      ) : String(broadcast.status) === 'sent' ? (
        <SentResult broadcast={broadcast} insight={insight} insightState={insightState} contentRef={contentRef} />
      ) : (
        <div className="max-w-3xl space-y-4">
          <section className="bg-canvas rounded-card border-hairline border p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-ink text-sm font-semibold">送信の進み具合</p>
              <span
                className={`rounded-pill px-2 py-0.5 text-xs ${
                  broadcast.status === 'sent'
                    ? 'bg-success-bg text-success'
                    : broadcast.status === 'sending'
                      ? 'bg-warning-bg text-warning'
                      : 'bg-canvas-sunken text-ink-faint'
                }`}
              >
                {STATUS_LABELS[broadcast.status] ?? broadcast.status}
              </span>
            </div>
            <p className="text-ink mt-2 text-sm tabular-nums">
              {success.toLocaleString('ja-JP')} / {total.toLocaleString('ja-JP')} 件
              {broadcast.status === 'sent' ? ' 完了' : ''}
            </p>
            <div className="bg-canvas-sunken mt-2 h-2 overflow-hidden rounded-full">
              <div
                className="bg-accent h-full"
                style={{ width: total > 0 ? `${(success / total) * 100}%` : '0%' }}
              />
            </div>
            {/* 開始・完了の時刻を別々に持っていない。sent_at は完了だけ。 */}
            <p className="text-ink-faint mt-2 text-xs">
              {broadcast.sentAt
                ? `完了 ${formatBroadcastDateTime(broadcast.sentAt)}`
                : '開始・完了の時刻は記録していません'}
            </p>
          </section>

          <div data-design="KPIs" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {/* 送信の欄は「これから」と「終わったこと」を書き分ける。
                予約しただけの配信に「予約どおり実行」と書くと、まだ起きて
                いないことを済んだことにしてしまう。 */}
            <Stat
              label="送信"
              value={total}
              unit="件"
              detail={
                broadcast.status === 'sent'
                  ? broadcast.scheduledAt
                    ? '予約どおり実行'
                    : '即時配信'
                  : broadcast.status === 'sending'
                    ? '送信中'
                    : broadcast.scheduledAt
                      ? '予約した時刻に実行します'
                      : 'まだ送っていません'
              }
            />
            {/*
              失敗数は `totalCount - successCount` でしか出せない。送信中は
              「まだ送っていないぶん」も同じ引き算に入るため、その数を失敗として
              出すと、起きていない失敗を作ることになる。完了してから出す。
            */}
            <Stat
              label="到達"
              value={success}
              unit="件"
              detail={
                broadcast.status === 'sent'
                  ? `${pct(success, total)} ・ 失敗 ${failed.toLocaleString('ja-JP')}件`
                  : broadcast.status === 'sending'
                    ? '送信中のため、失敗の数は終わってから確定します'
                    : '送信前のため、到達はまだありません'
              }
            />
            <Stat
              label="開封"
              value={insightState === 'ready' ? insight?.uniqueImpression ?? null : null}
              unit="件"
              detail={
                insightState === 'loading'
                  ? '読み込んでいます'
                  : insightState === 'error'
                    ? '読み込めませんでした'
                    : openInsightDetail(insight)
              }
            />
            <Stat
              label="クリック"
              value={insightState === 'ready' ? insight?.uniqueClick ?? null : null}
              unit="件"
              detail={
                insightState === 'loading'
                  ? '読み込んでいます'
                  : insightState === 'error'
                    ? '読み込めませんでした'
                    : clickInsightDetail(insight)
              }
            />
          </div>

          {insightState === 'error' ? (
            <div className="bg-canvas rounded-card border-hairline flex flex-wrap items-center justify-between gap-3 border p-4">
              <p className="text-ink-faint text-xs leading-relaxed">
                開封・クリックを読み込めませんでした。送信の件数は上のとおりです。
              </p>
              <Button onClick={() => setReloadToken((value) => value + 1)}>集計を再読み込み</Button>
            </div>
          ) : null}

          <section className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink text-sm font-semibold">アカウント別の内訳</p>
            {/* 複数アカウントに配ったとき、どのアカウントで何件届いたかを
                残していない。totalCount / successCount は全体の合計だけ。 */}
            <p className="text-ink-faint mt-2 text-xs leading-relaxed">
              アカウントごとの送信・到達・開封は記録していません。複数アカウントに配った場合も、上の数は合計です。
            </p>
          </section>

          <section className="bg-canvas rounded-card border-hairline border p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-ink text-sm font-semibold">この配信の設定</p>
              <button
                disabled
                title="同じ設定での作り直しは準備中です"
                className="border-hairline text-ink-faint rounded-control border px-3 py-1 text-xs opacity-50"
              >
                同じ設定で作り直す
              </button>
            </div>
            {/* 押せない理由は吹き出しだけでなく本文にも置く。触って初めて
                分かる形にすると、押せないことしか伝わらない。 */}
            <p className="text-ink-faint mt-2 text-xs leading-relaxed">
              「複製して作る」「同じ設定で作り直す」は、既にある配信を種にして作り直す口がまだないため押せません。作成は空から始まります。
            </p>
            <dl className="mt-3 space-y-2 text-sm">
              <Row label="宛先の条件" value={broadcast.targetType === 'all' ? 'すべての友だち' : '絞り込みあり'} />
              <Row
                label="対象人数"
                value={`${total.toLocaleString('ja-JP')}人（ブロック中を自動で除外）`}
              />
              <Row label="メッセージ" value={`1通（${messageTypeLabel(broadcast.messageType)}）`} />
              <Row
                label="送信タイミング"
                value={
                  broadcast.scheduledAt
                    ? `${formatBroadcastDateTime(broadcast.scheduledAt)} に予約`
                    : '即時配信'
                }
              />
              {/* 誰が作ったかを記録していない。 */}
              <Row
                label="作成者"
                value={broadcast.createdAt
                  ? `記録していません ・ ${formatBroadcastDateTime(broadcast.createdAt)} 作成`
                  : '記録していません ・ 作成日時 —'}
              />
            </dl>
          </section>

          <section className="bg-canvas rounded-card border-hairline border p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-ink text-sm font-semibold">クリックされたリンク</p>
              <Link href="/inflow-links" className="text-accent text-xs hover:underline">
                流入経路で見る
              </Link>
            </div>
            {/* どのリンクがどの配信に入っていたかを結ぶ記録が無い（18-29）。 */}
            <p className="text-ink-faint mt-2 text-xs leading-relaxed">
              配信ごとのリンク別クリックはまだ出せません。リンク全体のクリックは「分析 → URLクリック」で見られます。
            </p>
          </section>

          <section
            ref={contentRef}
            id="broadcast-content"
            className="bg-canvas rounded-card border-hairline scroll-mt-20 border p-5"
          >
            <p className="text-ink text-sm font-semibold">送った内容</p>
            <p className="text-ink-faint mt-0.5 text-xs">実際に届いた形</p>
            <p className="text-ink-faint mb-2 mt-1 text-xs">実際のLINE表示に近い確認用プレビューです。</p>
            <div className="bg-canvas-sunken rounded-card p-3">
              <p className="text-ink rounded-2xl bg-white px-4 py-3 text-sm leading-6 whitespace-pre-wrap">
                {broadcast.messageContent}
              </p>
            </div>
          </section>

          <section className="bg-canvas rounded-card border-hairline border p-5">
            <p className="text-ink text-sm font-semibold">数え方</p>
            <ul className="text-ink-faint mt-2 space-y-1.5 text-xs leading-relaxed">
              <li>
                ・開封は LINE の集計値です。個人単位では取れないため「誰が読んだか」は分かりません
              </li>
              <li>・配信対象が20人未満のときは、LINE側の仕様で開封数・クリック数が表示されません</li>
              {/* 上のクリックは LINE の集計値（`broadcast_insights.unique_click`）。
                  短縮URLの実測は別の数で、この欄には出していない。 */}
              <li>
                ・クリックも LINE の集計値で、母数は開封ではなく到達です。短縮URL（/t/…）の実測とは数字がずれることがあります
              </li>
            </ul>
          </section>

          <Link
            href="/broadcasts"
            className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken inline-block border px-4 py-2 text-sm font-medium"
          >
            一覧へ戻る
          </Link>
        </div>
      )}
    </div>
  )
}

function rateText(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return '—'
  return `${((rate <= 1 ? rate * 100 : rate)).toFixed(1)}%`
}

function SentResult({
  broadcast,
  insight,
  insightState,
  contentRef,
}: {
  broadcast: ApiBroadcast
  insight: (BroadcastInsight & { suppressedByAudienceSize: boolean }) | null
  insightState: 'loading' | 'ready' | 'error'
  contentRef: { current: HTMLElement | null }
}) {
  const delivered = insight?.delivered ?? broadcast.successCount
  const opened = insight?.opens?.count ?? insight?.uniqueImpression ?? null
  const openRate = insight?.opens?.rate ?? insight?.openRate ?? null
  const failed = Math.max(0, broadcast.totalCount - broadcast.successCount)

  return (
    <div className="space-y-4">
      <nav aria-label="配信内容を見る" className="bg-canvas-sunken rounded-card grid grid-cols-5 p-1 text-center text-sm font-semibold">
        {['概要', 'クリック', '友だち', 'エラー', '配信内容'].map((label, index) => (
          <span key={label} className={index === 0 ? 'bg-canvas text-accent rounded-control px-3 py-2' : 'text-ink-secondary px-3 py-2'}>{label}</span>
        ))}
      </nav>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <section className="bg-canvas rounded-card border-hairline border p-5">
            <h2 className="text-ink text-base font-bold">配信結果</h2>
            <p className="text-ink-faint mt-1 text-xs">送信・開封・クリック・ブロックを確認します。</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="border-hairline rounded-control border p-3">
                <p className="text-ink-faint text-xs font-semibold">送信成功</p>
                <p className="text-ink mt-2 text-sm font-bold">{broadcast.totalCount > 0 ? rateText(delivered / broadcast.totalCount) : '—'}</p>
                <p className="text-ink mt-1 text-lg font-bold">{delivered.toLocaleString('ja-JP')}人</p>
                <p className="text-ink-faint text-xs">届いた人</p>
              </div>
              <div className="border-hairline rounded-control border p-3">
                <p className="text-ink-faint text-xs font-semibold">開封</p>
                <p className="text-ink mt-2 text-sm font-bold">{insightState === 'loading' ? '読込中' : rateText(openRate)}</p>
                <p className="text-ink mt-1 text-lg font-bold">{opened == null ? '—' : `${opened.toLocaleString('ja-JP')}人`}</p>
                <p className="text-ink-faint text-xs">開いた人</p>
              </div>
            </div>
          </section>

          <section className="bg-canvas rounded-card border-hairline border p-5">
            <h2 className="text-ink text-base font-bold">反応</h2>
            <p className="text-ink-faint mt-1 text-xs">ボタンとリンクごとの結果です。</p>
            {insight?.links?.length ? (
              <div className="mt-3 space-y-2">
                {insight.links.map((link) => (
                  <div key={link.id} className="bg-canvas-sunken rounded-control flex items-center justify-between gap-4 p-3">
                    <div className="min-w-0"><p className="text-ink truncate text-sm font-bold" title={link.label}>{link.label}</p><p className="text-ink-faint truncate text-xs" title={link.url}>{link.url}</p></div>
                    <p className="text-ink-secondary shrink-0 text-xs">クリック {link.uniqueClickCount.toLocaleString('ja-JP')}人（{rateText(link.clickRate)}）</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-ink-faint bg-canvas-sunken mt-3 rounded-control p-3 text-xs">計測したボタン・リンクはありません。</p>
            )}
            <div className="bg-canvas-sunken mt-3 rounded-control p-3">
              <p className="text-ink text-sm font-bold">エラー</p>
              <p className="text-ink-faint mt-1 text-xs">送信失敗 {failed.toLocaleString('ja-JP')}人</p>
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <section className="bg-canvas rounded-card border-hairline border p-5">
            <h2 className="text-ink text-base font-bold">配信した設定</h2>
            <p className="text-ink-faint mt-1 text-xs">この配信で使った対象と送信方法です。</p>
            <dl className="mt-4 space-y-3 text-sm">
              <Row label="配信済み" value={`${delivered.toLocaleString('ja-JP')}人`} />
              <Row label="開封率" value={rateText(openRate)} />
              <Row label="クリック率" value={rateText(insight?.clickRate)} />
            </dl>
          </section>

          <section ref={contentRef} id="broadcast-content" className="bg-canvas rounded-card border-hairline border p-5">
            <h2 className="text-ink text-base font-bold">メッセージプレビュー</h2>
            <p className="text-ink-faint mt-1 text-xs">実際のLINE表示に近い確認用プレビューです。</p>
            <div className="bg-info mt-3 min-h-48 rounded-card p-4">
              <p className="text-ink bg-canvas rounded-control px-4 py-3 text-sm leading-6 whitespace-pre-wrap">{broadcast.messageContent}</p>
              {broadcast.messageOptions?.buttons?.map((button) => (
                <p key={`${button.label}-${button.value}`} className="text-action bg-canvas mt-2 truncate rounded-control px-3 py-2 text-center text-xs font-bold" title={button.value}>{button.label}</p>
              ))}
            </div>
          </section>
        </div>
      </div>

      {insightState === 'error' && <p role="alert" className="text-danger text-xs">開封・クリックを読み込めませんでした。</p>}
    </div>
  )
}

function Stat({
  label,
  value,
  unit,
  detail,
}: {
  label: string
  value: number | null
  unit: string
  detail: string
}) {
  return (
    <div className="bg-canvas rounded-card border-hairline border p-4">
      <p className="text-ink-faint text-xs">{label}</p>
      <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
        {value == null ? '—' : value.toLocaleString('ja-JP')}
        <span className="text-ink-faint ml-0.5 text-xs font-normal">{unit}</span>
      </p>
      <p className="text-ink-faint mt-0.5 text-xs">{detail}</p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-faint shrink-0">{label}</dt>
      <dd className="text-ink-secondary min-w-0 text-right">{value}</dd>
    </div>
  )
}

export default function BroadcastDetailPage() {
  usePageTitle('配信の詳細')
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <BroadcastDetailInner />
    </Suspense>
  )
}
