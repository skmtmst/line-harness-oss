'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import { usePageTitle } from '@/components/shell/page-chrome'
import Progress from '@/components/shared/progress'
import SelectField from '@/components/shared/select-field'
import Avatar from '@/components/shared/avatar'
import Button from '@/components/shared/button'
import { ChevronDown } from 'lucide-react'

interface LineAccount {
  id: string
  channelId: string
  name: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface AccountHealthLog {
  id: string
  lineAccountId: string
  errorCode: number | null
  errorCount: number
  checkPeriod: string
  riskLevel: 'normal' | 'warning' | 'danger'
  createdAt: string
}

type AccountHealthState = AccountHealthLog['riskLevel'] | 'unknown' | 'error'

interface AccountHealthSnapshot {
  state: AccountHealthState
  logs: AccountHealthLog[]
}

interface AccountHealthResponse {
  success: boolean
  data?: unknown
}

interface AccountMigration {
  id: string
  fromAccountId: string
  toAccountId: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  migratedCount: number
  totalCount: number
  createdAt: string
  completedAt: string | null
}

type MigrationLoadState = 'loading' | 'ready' | 'error'

const riskConfig = {
  normal: { label: '正常', color: 'bg-success', textColor: 'text-success', bgColor: 'bg-success-bg' },
  warning: { label: '警告', color: 'bg-status-warn', textColor: 'text-status-warn-deep', bgColor: 'bg-status-warn-soft' },
  danger: { label: '危険', color: 'bg-danger', textColor: 'text-danger', bgColor: 'bg-danger-bg' },
  unknown: { label: '未確認', color: 'bg-ink-faint', textColor: 'text-ink-faint', bgColor: 'bg-canvas-sunken' },
  error: { label: '取得失敗', color: 'bg-danger', textColor: 'text-danger', bgColor: 'bg-danger-bg' },
} satisfies Record<AccountHealthState, { label: string; color: string; textColor: string; bgColor: string }>

function isRiskLevel(value: unknown): value is AccountHealthLog['riskLevel'] {
  return value === 'normal' || value === 'warning' || value === 'danger'
}

function resolveAccountHealth(response: AccountHealthResponse): AccountHealthSnapshot {
  if (!response.success) return { state: 'error', logs: [] }

  const payload = response.data && typeof response.data === 'object'
    ? response.data as { riskLevel?: unknown; logs?: unknown }
    : {}
  const logs = Array.isArray(payload.logs) ? payload.logs as AccountHealthLog[] : []
  const state = isRiskLevel(payload.riskLevel)
    ? payload.riskLevel
    : isRiskLevel(logs[0]?.riskLevel)
      ? logs[0].riskLevel
      : 'unknown'

  return { state, logs }
}

async function loadAccountHealthStates(
  accountIds: string[],
  getHealth: (accountId: string) => Promise<AccountHealthResponse>,
): Promise<Record<string, AccountHealthSnapshot>> {
  const entries = await Promise.all(accountIds.map(async (accountId) => {
    try {
      return [accountId, resolveAccountHealth(await getHealth(accountId))] as const
    } catch {
      return [accountId, { state: 'error', logs: [] }] as const
    }
  }))

  return Object.fromEntries(entries)
}

const statusConfig: Record<AccountMigration['status'], { label: string; textColor: string; bgColor: string }> = {
  pending: { label: '待機中', textColor: 'text-ink-secondary', bgColor: 'bg-canvas-sunken' },
  in_progress: { label: '移行中', textColor: 'text-status-info', bgColor: 'bg-status-info-soft' },
  completed: { label: '完了', textColor: 'text-success', bgColor: 'bg-success-bg' },
  failed: { label: '失敗', textColor: 'text-danger', bgColor: 'bg-danger-bg' },
}

export default function HealthPage() {
  usePageTitle('BAN検知ダッシュボード')
  const [accounts, setAccounts] = useState<LineAccount[]>([])
  const [healthLogs, setHealthLogs] = useState<Record<string, AccountHealthLog[]>>({})
  const [latestRisk, setLatestRisk] = useState<Record<string, AccountHealthState>>({})
  const [migrations, setMigrations] = useState<AccountMigration[]>([])
  const [migrationLoadState, setMigrationLoadState] = useState<MigrationLoadState>('loading')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [migrateFrom, setMigrateFrom] = useState<string | null>(null)
  const [migrateToId, setMigrateToId] = useState('')
  const [migrating, setMigrating] = useState(false)
  const [retryingHealthIds, setRetryingHealthIds] = useState<Set<string>>(new Set())

  const loadAccounts = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.health.accounts()
      if (res.success) {
        const data = res.data as unknown as LineAccount[]
        setAccounts(data)
        const snapshots = await loadAccountHealthStates(
          data.map((account) => account.id),
          (accountId) => api.health.getHealth(accountId),
        )
        setHealthLogs(Object.fromEntries(
          Object.entries(snapshots).map(([accountId, snapshot]) => [accountId, snapshot.logs]),
        ))
        setLatestRisk(Object.fromEntries(
          Object.entries(snapshots).map(([accountId, snapshot]) => [accountId, snapshot.state]),
        ))
      } else {
        setError('アカウント情報の取得に失敗しました。もう一度読み込んでください。')
      }
    } catch {
      setError('アカウント情報の読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [])

  const retryAccountHealth = useCallback(async (accountId: string) => {
    setRetryingHealthIds((current) => new Set(current).add(accountId))
    const snapshots = await loadAccountHealthStates(
      [accountId],
      (id) => api.health.getHealth(id),
    )
    const snapshot = snapshots[accountId]
    setHealthLogs((current) => ({ ...current, [accountId]: snapshot.logs }))
    setLatestRisk((current) => ({ ...current, [accountId]: snapshot.state }))
    setRetryingHealthIds((current) => {
      const next = new Set(current)
      next.delete(accountId)
      return next
    })
  }, [])

  const loadMigrations = useCallback(async () => {
    setMigrationLoadState('loading')
    try {
      const res = await api.health.migrations()
      if (res.success && Array.isArray(res.data)) {
        setMigrations(res.data as AccountMigration[])
        setMigrationLoadState('ready')
      } else {
        setMigrationLoadState('error')
      }
    } catch {
      setMigrationLoadState('error')
    }
  }, [])

  useEffect(() => {
    loadAccounts()
    loadMigrations()
  }, [loadAccounts, loadMigrations])

  const handleExpand = (accountId: string) => {
    setExpandedId(expandedId === accountId ? null : accountId)
  }

  const handleMigrate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!migrateFrom || !migrateToId) return
    setMigrating(true)
    try {
      await api.health.migrate(migrateFrom, { toAccountId: migrateToId })
      setMigrateFrom(null)
      setMigrateToId('')
      loadMigrations()
    } catch {
      setError('移行リクエストに失敗しました。通信を確かめて、もう一度お試しください。')
    } finally {
      setMigrating(false)
    }
  }

  const getAccountName = (id: string): string => {
    const account = accounts.find((a) => a.id === id)
    return account?.name || id
  }

  return (
    <div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-danger-bg border border-danger/30 rounded-card text-danger text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="bg-canvas rounded-card border border-hairline p-8 text-center text-ink-faint">
          読み込み中...
        </div>
      ) : accounts.length === 0 ? (
        <div className="bg-canvas rounded-card border border-hairline p-8 text-center text-ink-faint">
          <p className="mb-2">LINEアカウントが登録されていません</p>
          <p className="text-xs text-ink-faint">先にアカウント管理からLINEアカウントを登録してください</p>
        </div>
      ) : (
        <>
          {/* Account Health Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            {accounts.map((account) => {
              const risk = latestRisk[account.id] ?? 'unknown'
              const config = riskConfig[risk]
              const isExpanded = expandedId === account.id
              const logs = healthLogs[account.id] || []
              const healthUnavailable = risk === 'unknown' || risk === 'error'

              return (
                <div key={account.id} className="bg-canvas rounded-card border border-hairline overflow-hidden">
                  <button
                    onClick={() => handleExpand(account.id)}
                    className="w-full p-4 text-left hover:bg-canvas-sunken transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {/* ★V7：全員同じ「L」の緑の四角では見分けられないので、他の画面と同じ頭文字の丸にする。 */}
                        <Avatar name={account.name} size={40} />
                        <div>
                          <h3 className="text-sm font-bold text-ink">{account.name}</h3>
                          <p className="text-xs text-ink-faint">チャネル {account.channelId}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium px-2.5 py-1 rounded-full ${config.bgColor} ${config.textColor}`}>
                          <span className={`w-2 h-2 rounded-full ${config.color} ${risk === 'danger' ? 'animate-pulse' : ''}`} />
                          {config.label}
                        </span>
                        <ChevronDown aria-hidden="true" className={`size-4 text-ink-faint transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </div>
                    </div>
                  </button>

                  {/* Expanded: Health Logs */}
                  {isExpanded && (
                    <div className="border-t border-hairline p-4">
                      {healthUnavailable && (
                        <div className="border-hairline bg-canvas-sunken text-ink-secondary mb-3 rounded-card border p-3 text-sm">
                          <p>
                            {risk === 'error'
                              ? 'ヘルス情報を取得できませんでした。'
                              : 'まだ確認結果がありません。'}
                          </p>
                          <button
                            type="button"
                            onClick={() => void retryAccountHealth(account.id)}
                            disabled={retryingHealthIds.has(account.id)}
                            className="text-action mt-2 text-sm font-medium underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {retryingHealthIds.has(account.id) ? '再取得中...' : '再試行'}
                          </button>
                        </div>
                      )}

                      {risk === 'danger' && (
                        <div className="mb-3">
                          <button
                            onClick={() => {
                              setMigrateFrom(account.id)
                              setMigrateToId('')
                            }}
                            className="px-3 py-1.5 rounded-control text-white text-xs font-medium bg-danger hover:brightness-92 transition-colors"
                          >
                            友だちを移行する
                          </button>
                        </div>
                      )}

                      {logs.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-xs text-ink-secondary border-b border-hairline">
                                <th className="px-4 py-3 font-medium">エラーコード</th>
                                <th className="px-4 py-3 font-medium">エラー数</th>
                                <th className="px-4 py-3 font-medium">チェック期間</th>
                                <th className="px-4 py-3 font-medium">リスク</th>
                                <th className="px-4 py-3 font-medium">日時</th>
                              </tr>
                            </thead>
                            <tbody>
                              {logs.map((log) => {
                                const logConfig = riskConfig[log.riskLevel]
                                return (
                                  <tr key={log.id} className="border-b border-hairline">
                                    <td className="py-2 pr-3 font-mono text-ink-secondary">
                                      {log.errorCode !== null ? log.errorCode : '-'}
                                    </td>
                                    <td className="py-2 pr-3 text-ink-secondary">{log.errorCount}</td>
                                    <td className="py-2 pr-3 text-ink-secondary">{log.checkPeriod}</td>
                                    <td className="py-2 pr-3">
                                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${logConfig.bgColor} ${logConfig.textColor}`}>
                                        <span className={`w-1.5 h-1.5 rounded-full ${logConfig.color} ${log.riskLevel === 'danger' ? 'animate-pulse' : ''}`} />
                                        {logConfig.label}
                                      </span>
                                    </td>
                                    <td className="py-2 text-ink-faint text-xs">
                                      {new Date(log.createdAt).toLocaleString('ja-JP')}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : !healthUnavailable ? (
                        <p className="text-sm text-ink-faint text-center py-4">ヘルスログがありません</p>
                      ) : null}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Migration Form Modal */}
          {migrateFrom && (
            <div className="mb-8 bg-canvas rounded-card border border-danger/30 p-6">
              <h2 className="text-sm font-bold text-ink mb-4">
                友だち移行: {getAccountName(migrateFrom)}
              </h2>
              <form onSubmit={handleMigrate}>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-ink-secondary mb-1">移行先アカウント</label>
                  <SelectField
                    value={migrateToId}
                    onChange={(e) => setMigrateToId(e.target.value)}
                    aria-label="移行先アカウント"
                    className="w-full border border-hairline rounded-control px-3 py-2 text-sm bg-canvas focus:outline-none focus:ring-2 focus:ring-accent"
                    required
                    options={[
                      { value: '', label: '選択してください' },
                      ...accounts
                        .filter((account) => account.id !== migrateFrom && account.isActive)
                        .map((account) => ({
                          value: account.id,
                          label: `${account.name} (${account.channelId})`,
                        })),
                    ]}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Button type="submit" variant="primary" disabled={migrating || !migrateToId}>
                    {migrating ? '移行中...' : '移行を開始'}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      setMigrateFrom(null)
                      setMigrateToId('')
                    }}
                  >
                    キャンセル
                  </Button>
                </div>
              </form>
            </div>
          )}

          {/* Migrations Table */}
          <div>
            <h2 className="text-lg font-bold text-ink mb-4">移行履歴</h2>
            {migrationLoadState === 'loading' ? (
              <div className="border-hairline bg-canvas text-ink-faint rounded-card border p-8 text-center">
                移行履歴を読み込んでいます...
              </div>
            ) : migrationLoadState === 'error' ? (
              <div className="border-danger bg-danger-bg text-danger rounded-card border p-8 text-center">
                <p>移行履歴を取得できませんでした。</p>
                <button
                  type="button"
                  onClick={() => void loadMigrations()}
                  className="text-action mt-3 text-sm font-medium underline underline-offset-2"
                >
                  再読み込み
                </button>
              </div>
            ) : migrations.length === 0 ? (
              <div className="bg-canvas rounded-card border border-hairline p-8 text-center text-ink-faint">
                移行履歴はありません
              </div>
            ) : (
              <div className="bg-canvas rounded-card border border-hairline overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[640px]">
                    <thead>
                      <tr className="text-left text-xs text-ink-secondary bg-canvas-sunken border-b border-hairline">
                        <th className="px-4 py-3 font-medium">移行元</th>
                        <th className="px-4 py-3 font-medium">移行先</th>
                        <th className="px-4 py-3 font-medium">ステータス</th>
                        <th className="px-4 py-3 font-medium">進捗</th>
                        <th className="px-4 py-3 font-medium">開始日時</th>
                        <th className="px-4 py-3 font-medium">完了日時</th>
                      </tr>
                    </thead>
                    <tbody>
                      {migrations.map((migration) => {
                        const status = statusConfig[migration.status]
                        const countText = `${migration.migratedCount.toLocaleString('ja-JP')} / ${migration.totalCount.toLocaleString('ja-JP')} 人`
                        const percent = migration.totalCount > 0
                          ? (migration.migratedCount / migration.totalCount) * 100
                          : 0
                        return (
                          <tr key={migration.id} className="border-b border-hairline hover:bg-canvas-sunken">
                            <td className="px-4 py-3 text-ink font-medium">
                              {getAccountName(migration.fromAccountId)}
                            </td>
                            <td className="px-4 py-3 text-ink font-medium">
                              {getAccountName(migration.toAccountId)}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex text-xs font-medium px-2.5 py-1 rounded-full ${status.bgColor} ${status.textColor}`}>
                                {status.label}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              {/*
                                移行の進みは共通部品 Progress（★V7 xiHO8）で出す。
                                実行中→active、完了→done、失敗→partial（残りは赤の欠け）、
                                待ち→preparing。数は文字でも残す（n / m 人）。
                              */}
                              {migration.status === 'in_progress' ? (
                                <Progress state="active" title="移行中" percent={percent} countText={countText} className="min-w-48" />
                              ) : migration.status === 'completed' ? (
                                <Progress state="done" title="移行が完了しました" note={countText} className="min-w-48" />
                              ) : migration.status === 'failed' ? (
                                <Progress
                                  state="partial"
                                  title={migration.migratedCount > 0 ? `${countText}まで移行し、途中で止まりました` : `移行できませんでした（${countText}）`}
                                  percent={percent}
                                  className="min-w-48"
                                />
                              ) : (
                                <Progress state="preparing" title="移行待ち" note={countText} className="min-w-48" />
                              )}
                            </td>
                            <td className="px-4 py-3 text-ink-faint text-xs">
                              {new Date(migration.createdAt).toLocaleString('ja-JP')}
                            </td>
                            <td className="px-4 py-3 text-ink-faint text-xs">
                              {migration.completedAt
                                ? new Date(migration.completedAt).toLocaleString('ja-JP')
                                : '-'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
