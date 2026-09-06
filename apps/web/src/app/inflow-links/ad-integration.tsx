'use client'

import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import type { AdConversionLog, AdPlatform } from '@/lib/api'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import { TableHeadRow, Th } from '@/components/shared/table'

type AdView = 'metrics' | 'connections' | 'history'

const PROVIDERS = [
  { key: 'meta', label: 'Meta広告', clickId: 'fbclid' },
  { key: 'google', label: 'Google広告', clickId: 'gclid' },
  { key: 'x', label: 'X（旧Twitter）', clickId: 'twclid' },
  { key: 'tiktok', label: 'TikTok', clickId: 'ttclid' },
] as const

const STATUS_LABEL: Record<string, string> = {
  sent: '送れました',
  success: '送れました',
  pending: '待っています',
  failed: '断られました',
  skipped: '送っていません',
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'すべての状態' },
  { value: 'sent', label: '送れたもの' },
  { value: 'pending', label: '待っているもの' },
  { value: 'failed', label: '断られたもの' },
]

function platformLabel(platform: AdPlatform): string {
  return PROVIDERS.find((provider) => provider.key === platform.name)?.label
    ?? platform.displayName
    ?? platform.name
}

function accountLabel(platform: AdPlatform): string | null {
  for (const key of ['customer_id', 'pixel_id', 'pixel_code', 'account_id']) {
    const value = platform.config[key]
    if (typeof value === 'string' && value) return value
  }
  return null
}

function matchesStatus(log: AdConversionLog, status: string): boolean {
  if (status === 'all') return true
  if (status === 'sent') return log.status === 'sent' || log.status === 'success'
  return log.status === status
}

function safeCsv(logs: AdConversionLog[]): string {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`
  const rows = logs.map((log) => [
    log.createdAt,
    log.eventName,
    log.clickIdType ?? '経路不明',
    STATUS_LABEL[log.status] ?? '状態不明',
  ].map((value) => quote(value)).join(','))
  return ['"日時","成果","クリックの種類","状態"', ...rows].join('\n')
}

export default function AdIntegration({ view }: { view: AdView }) {
  const [platforms, setPlatforms] = useState<AdPlatform[]>([])
  const [logs, setLogs] = useState<AdConversionLog[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')

  const load = async () => {
    setLoading(true)
    setFailed(false)
    try {
      const response = await api.adPlatforms.list()
      if (!response.success) {
        setFailed(true)
        return
      }
      setPlatforms(response.data)
      const logResponses = await Promise.all(
        response.data.map((platform) => api.adPlatforms.logs(platform.id, 100).catch(() => null)),
      )
      setLogs(
        logResponses
          .flatMap((result) => result?.success ? result.data : [])
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      )
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const connected = platforms.filter((platform) => platform.isActive)
  const sentCount = logs.filter((log) => matchesStatus(log, 'sent')).length
  const pendingCount = logs.filter((log) => log.status === 'pending').length
  const failedCount = logs.filter((log) => log.status === 'failed').length
  const normalizedQuery = query.trim().toLocaleLowerCase('ja')
  const visibleLogs = useMemo(
    () => logs.filter((log) => matchesStatus(log, status)).filter((log) => {
      if (!normalizedQuery) return true
      return [log.eventName, log.clickIdType ?? '', STATUS_LABEL[log.status] ?? '']
        .some((value) => value.toLocaleLowerCase('ja').includes(normalizedQuery))
    }),
    [logs, normalizedQuery, status],
  )

  const exportLogs = () => {
    const blob = new Blob([`\uFEFF${safeCsv(visibleLogs)}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `広告への送信履歴_${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return <ListState kind="loading" title="広告との接続状況を読み込んでいます" />
  }

  if (failed) {
    return (
      <ListState
        kind="error"
        title="広告との接続状況を表示できませんでした"
        description="接続設定は消えていません。状態を読み直して、もう一度お試しください。"
        action={<Button onClick={() => void load()}>広告の状態を再読み込み</Button>}
      />
    )
  }

  if (view === 'history') {
    return (
      <div className="space-y-4" data-design-node="Im2b1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-ink-faint">広告とのつなぎ</p>
            <h2 className="text-lg font-bold text-ink">広告への送信履歴</h2>
          </div>
          <Button href="/inflow-links?tab=connections">広告とのつなぎへ戻る</Button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Metric label="送った件数" value={sentCount} detail={`読み込んだ直近 ${logs.length}件のうち`} />
          <Metric label="待っている" value={pendingCount} detail="送信処理を待っています" />
          <Metric label="断られた" value={failedCount} detail="理由を確認してください" tone={failedCount > 0 ? 'danger' : 'default'} />
        </div>

        <p className="rounded-card bg-info-bg px-4 py-3 text-xs leading-relaxed text-ink-secondary">
          送るのは、成果と広告のクリックが結びついたものだけです。結びつかないものは送りません。
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <SearchField
            value={query}
            onChange={setQuery}
            onClear={() => setQuery('')}
            placeholder="成果・クリックの種類で探す"
            aria-label="成果・クリックの種類で探す"
            className="w-full sm:w-80"
          />
          <Select value={status} onChange={setStatus} options={STATUS_OPTIONS} aria-label="送信状態" />
          <Button onClick={exportLogs} disabled={visibleLogs.length === 0}>CSVで書き出す</Button>
        </div>

        {visibleLogs.length === 0 ? (
          <ListState
            kind="empty"
            title="条件に合う送信履歴はありません"
            description="成果と広告のクリックが結びつき、送信処理が始まるとここに並びます。"
          />
        ) : (
          <section className="overflow-hidden rounded-card border border-hairline bg-canvas">
            <table className="w-full table-fixed text-xs">
              <thead className="border-b border-hairline bg-canvas-sunken text-ink-faint">
                <TableHeadRow>
                  <Th>いつ・何の成果</Th>
                  <Th>媒体</Th>
                  <Th>クリックの種類</Th>
                  <Th>状態</Th>
                  <Th>次の予定</Th>
                </TableHeadRow>
              </thead>
              <tbody className="divide-y divide-hairline">
                {visibleLogs.map((log) => {
                  const platform = platforms.find((item) => item.id === log.adPlatformId)
                  return (
                    <tr key={log.id}>
                      <td className="px-4 py-3 text-ink">
                        <span className="block font-semibold">{log.eventName}</span>
                        <span className="mt-0.5 block text-ink-faint">{log.createdAt.slice(0, 16).replace('T', ' ').replaceAll('-', '/')}</span>
                      </td>
                      <td className="px-4 py-3 text-ink-secondary">{platform ? platformLabel(platform) : '取得できません'}</td>
                      <td className="px-4 py-3 text-ink-secondary">{log.clickIdType ?? '経路不明'}</td>
                      <td className="px-4 py-3">
                        <span className={log.status === 'failed' ? 'font-semibold text-status-danger' : 'text-ink-secondary'}>
                          {STATUS_LABEL[log.status] ?? '状態不明'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-ink-faint">
                        {log.status === 'failed' ? '再試行の記録APIが接続されると表示されます' : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        )}

        <p className="text-xs leading-relaxed text-ink-faint">
          試行回数・次回試行日時・まとめてやり直す操作は、再試行の記録APIが接続されたあとに表示します。成功した成果を重ねて送る操作は表示しません。
        </p>
      </div>
    )
  }

  if (view === 'connections') {
    return (
      <div className="space-y-4" data-design-node="BuVDB">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-ink-faint">流入と計測</p>
            <h2 className="text-lg font-bold text-ink">広告とのつなぎ</h2>
          </div>
          <Button href="/inflow-links?tab=connections&view=history">送信履歴を見る</Button>
        </div>

        <p className="rounded-card bg-info-bg px-4 py-3 text-xs leading-relaxed text-ink-secondary">
          広告をつながなくても流入リンクの計測は使えます。つなぐと、成果を広告側へ安全に返せるようになります。
        </p>

        <section className="rounded-card border border-hairline bg-canvas p-4">
          <h3 className="text-sm font-bold text-ink">つないでいる広告</h3>
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {PROVIDERS.map((provider) => {
              const platform = platforms.find((item) => item.name === provider.key)
              const active = platform?.isActive === true
              return (
                <div key={provider.key} className="rounded-control border border-hairline p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">{provider.label}</p>
                      <p className="mt-1 text-xs text-ink-faint">クリックの目印 {provider.clickId}</p>
                      {platform && accountLabel(platform) && (
                        <p className="mt-1 text-xs text-ink-faint">広告アカウント {accountLabel(platform)}</p>
                      )}
                    </div>
                    <span className={`rounded-pill px-2 py-1 text-xs font-semibold ${active ? 'bg-accent-soft text-accent-deep' : 'bg-canvas-sunken text-ink-faint'}`}>
                      {active ? 'つながっています' : 'つないでいません'}
                    </span>
                  </div>
                  {!platform && (
                    <p className="mt-3 text-xs leading-relaxed text-ink-faint">
                      接続設定APIが接続されると、この媒体をつなぐ操作が表示されます。
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        <section className="rounded-card border border-hairline bg-canvas p-4">
          <h3 className="text-sm font-bold text-ink">成果地点と、広告に返す名前の対応</h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-faint">
            対応が付いていない成果は広告へ返しません。成果対応APIが接続されると、うちの成果地点・媒体ごとの名前・状態・返した件数がここに並びます。
          </p>
        </section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="rounded-card border border-hairline bg-canvas p-4">
            <h3 className="text-sm font-bold text-ink">返すしくみ</h3>
            <ol className="mt-3 space-y-2 text-xs leading-relaxed text-ink-secondary">
              <li><strong>1. クリックの目印を持ち帰る</strong><br />中継リンクを通った人だけ広告と結びつきます。</li>
              <li><strong>2. 成果が出たら順に送る</strong><br />待ち行列に入れてから送ります。</li>
              <li><strong>3. 同じ成果は2回送らない</strong><br />やり直しても同じ目印を使います。</li>
            </ol>
          </section>
          <section className="rounded-card border border-hairline bg-canvas p-4">
            <h3 className="text-sm font-bold text-ink">気をつけること</h3>
            <ul className="mt-3 space-y-2 text-xs leading-relaxed text-ink-secondary">
              <li>中継リンクを通らないと広告と結びつきません。</li>
              <li>秘密の鍵は画面に表示しません。</li>
              <li>お客様の名前やメールアドレスは広告へ送りません。</li>
            </ul>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4" data-design-node="v0HaI">
      <p className="rounded-card bg-info-bg px-4 py-3 text-xs leading-relaxed text-ink-secondary">
        広告の管理画面ではクリック数までを確認できます。広告実績の取込APIが接続されると、広告費・友だち追加・成果までを同じ画面で比較できます。
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="つないだ広告" value={connected.length} detail={connected.length > 0 ? connected.map(platformLabel).join('・') : 'まだ接続がありません'} />
        <Metric label="今月の広告費" value={null} detail="広告実績の取込後に表示します" />
        <Metric label="友だち1人あたり" value={null} detail="費用と流入人数がそろうと表示します" />
        <Metric label="成果1件あたり" value={null} detail="費用と成果がそろうと表示します" />
      </div>

      <section className="rounded-card border border-hairline bg-canvas p-4">
        <h3 className="text-sm font-bold text-ink">広告アカウント</h3>
        {platforms.length === 0 ? (
          <p className="mt-2 text-xs leading-relaxed text-ink-faint">
            まだ広告アカウントをつないでいません。接続設定APIが接続されると、媒体ごとの接続操作が「広告とのつなぎ」に表示されます。
          </p>
        ) : (
          <div className="mt-3 divide-y divide-hairline">
            {platforms.map((platform) => (
              <div key={platform.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
                <div>
                  <p className="text-sm font-semibold text-ink">{platformLabel(platform)}</p>
                  <p className="mt-0.5 text-xs text-ink-faint">{platform.isActive ? 'つながっています' : '停止中'}</p>
                </div>
                <span className="text-xs text-ink-faint">実績の取込は未接続</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-card border border-hairline bg-canvas p-4">
        <h3 className="text-sm font-bold text-ink">広告のまとまり</h3>
        <p className="mt-2 text-xs leading-relaxed text-ink-faint">
          広告実績の取込APIが接続されると、媒体・キャンペーン・広告グループごとの費用、クリック、友だち追加、成果を通貨別に表示します。取得できていない費用を0円とは表示しません。
        </p>
      </section>
    </div>
  )
}

function Metric({
  label,
  value,
  detail,
  tone = 'default',
}: {
  label: string
  value: number | null
  detail: string
  tone?: 'default' | 'danger'
}) {
  return (
    <div className="rounded-card border border-hairline bg-canvas p-4">
      <p className="text-xs text-ink-faint">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tone === 'danger' ? 'text-status-danger' : 'text-ink'}`}>
        {value == null ? '—' : value.toLocaleString('ja-JP')}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-ink-faint">{detail}</p>
    </div>
  )
}
