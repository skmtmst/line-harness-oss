'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { AdConversionLog, AdPlatform } from '@/lib/api'
import { TableHeadRow, Th } from '@/components/shared/table'
import { useAccount } from '@/contexts/account-context'
import ListState from '@/components/shared/list-state'

/**
 * 広告連携（設計 V2 6-8）。
 *
 * できているのは「LINEで起きた成果を広告に返す」ほうだけ。返した記録は
 * ad_conversion_logs に残っているので、そこは本物の数字を出せる。
 *
 * 設計にある**広告費・クリック数・キャンペーン別・売上**は、広告側から
 * 取り込む口が無い。ad_platforms が持っているのは送信用の鍵だけで、
 * 費用や表示回数は一度も取ってきていない。ここを埋めるには Google Ads の
 * レポートAPIを叩く仕組みが要る。数字を作らず「—」を出している。
 */

const PLATFORM_LABEL: Record<string, string> = {
  google: 'Google広告',
  meta: 'Meta広告',
  x: 'X広告',
  tiktok: 'TikTok広告',
}

const STATUS_LABEL: Record<string, string> = {
  sent: '送信済み',
  success: '送信済み',
  pending: '送信待ち',
  retry_wait: '再試行待ち',
  failed: '失敗',
  skipped: '送信しない',
}

/** 表示に使う口座番号などを config から拾う。鍵は伏せて返ってくる。 */
function accountLabel(platform: AdPlatform): string | null {
  const c = platform.config
  for (const key of ['customer_id', 'pixel_id', 'pixel_code', 'account_id']) {
    const v = c[key]
    if (typeof v === 'string' && v) return v
  }
  return null
}

export default function AdIntegration() {
  const { selectedAccountId } = useAccount()
  const [platforms, setPlatforms] = useState<AdPlatform[]>([])
  const [logs, setLogs] = useState<AdConversionLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setPlatforms([])
    setLogs([])
    if (!selectedAccountId) {
      setLoading(false)
      return () => {
        cancelled = true
      }
    }
    setLoading(true)
    void (async () => {
      const accountAtRequest = selectedAccountId
      const res = await api.adPlatforms.list(accountAtRequest)
      if (cancelled || !res.success) {
        if (!cancelled) setLoading(false)
        return
      }
      setPlatforms(res.data)
      const active = res.data.find((p) => p.isActive) ?? res.data[0]
      if (active) {
        const logRes = await api.adPlatforms.logs(active.id, accountAtRequest, 20)
        if (!cancelled && logRes.success) setLogs(logRes.data)
      }
      if (!cancelled) setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [selectedAccountId])

  const connected = platforms.filter((p) => p.isActive)
  const sentCount = logs.filter((l) => l.status === 'sent' || l.status === 'success').length

  if (loading) {
    return (
      <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-12 text-center text-sm">
        読み込み中...
      </div>
    )
  }

  if (!selectedAccountId) {
    return (
      <ListState
        kind="empty"
        title="LINEアカウントを選んでください"
        description="広告との接続と送信履歴は、上部で選んだLINEアカウントごとに表示します。"
      />
    )
  }

  return (
    <div className="space-y-4" data-design-node="v0HaI">
      <p className="text-ink-secondary text-sm leading-relaxed">
        広告から来た友だちを計測し、LINEで起きた成果を広告側に返します。広告費に対して実際にいくら売れたかを見るには、広告側の費用を取り込む必要があり、そちらはまだできていません。
      </p>

      {/* ---- つながっているか ---- */}
      <section className="bg-canvas rounded-card border-hairline border p-4">
        {connected.length === 0 ? (
          <div>
            <p className="text-ink text-sm font-bold">まだ広告とつながっていません</p>
            <p className="text-ink-faint mt-1 text-xs leading-relaxed">
              広告を使っていない場合は、このままで問題ありません。つなぐと、LINEで起きた成果を広告側に返せるようになります。
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {connected.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-ink text-sm font-bold">
                    {PLATFORM_LABEL[p.name] ?? p.displayName ?? p.name}とつながっています
                  </p>
                  <p className="text-ink-faint mt-0.5 text-xs">
                    {accountLabel(p) ? `アカウント ${accountLabel(p)} ・ ` : ''}
                    成果の送信 有効
                    {/* 同期という考え方が実装に無い。成果が起きたその場で送っている。 */}
                    {' ・ '}成果が起きたその場で送ります
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---- KPI ---- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <div className="bg-canvas rounded-card border-hairline border p-4">
          <p className="text-ink-faint text-xs">広告側へ返した成果</p>
          <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
            {sentCount}
            <span className="text-ink-faint ml-0.5 text-xs font-normal">件</span>
          </p>
          <p className="text-ink-faint mt-0.5 text-xs">直近{logs.length}件のうち</p>
        </div>
        {/* 以下4枚は広告側から取り込む数字。取り込む口が無い。 */}
        {[
          ['広告経由の友だち', 'クリックIDと友だちの結び付けを集計していません'],
          ['広告費', '広告側の費用を取り込んでいません'],
          ['成果1件あたり', '広告費が無いので出せません'],
          ['売上・ROAS', '広告費が無いので出せません'],
        ].map(([label, why]) => (
          <div key={label} className="bg-canvas rounded-card border-hairline border p-4">
            <p className="text-ink-faint text-xs">{label}</p>
            <p className="text-ink-faint mt-1 text-2xl font-bold">—</p>
            <p className="text-ink-faint mt-0.5 text-xs">{why}</p>
          </div>
        ))}
      </div>

      {/* ---- キャンペーン別 ---- */}
      <section className="bg-canvas rounded-card border-hairline border">
        <div className="border-hairline border-b px-4 py-3">
          <h2 className="text-ink text-sm font-bold">キャンペーン別の成果</h2>
        </div>
        <p className="text-ink-faint p-8 text-center text-sm leading-relaxed">
          キャンペーンごとのクリック・友だち追加・広告費は、広告側から取り込む必要があります。その取り込みがまだありません。
        </p>
      </section>

      {/* ---- 返している成果 ---- */}
      <section className="bg-canvas rounded-card border-hairline border">
        <div className="border-hairline border-b px-4 py-3">
          <h2 className="text-ink text-sm font-bold">広告へ返している成果</h2>
          <p className="text-ink-faint mt-0.5 text-xs">
            LINEで起きた成果を、広告のクリックに結びつけて送っています。
          </p>
        </div>
        {logs.length === 0 ? (
          <p className="text-ink-faint p-8 text-center text-sm">まだ送った記録がありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <TableHeadRow>
                  <Th>日時</Th>
                  <Th>成果</Th>
                  <Th>クリックの種類</Th>
                  <Th>状態</Th>
                  <Th>試行</Th>
                  <Th>次の再試行</Th>
                </TableHeadRow>
              </thead>
              <tbody className="divide-hairline divide-y">
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="text-ink-secondary px-4 py-2 tabular-nums">
                      {l.createdAt.slice(5, 16).replace('T', ' ').replaceAll('-', '/')}
                    </td>
                    <td className="text-ink px-4 py-2">{l.eventName}</td>
                    <td className="text-ink-faint px-4 py-2">
                      {l.clickId ? (l.clickIdType ?? 'クリックID') : '経路が不明'}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={
                          l.status === 'failed' ? 'text-danger text-xs' : 'text-ink-secondary text-xs'
                        }
                        title={l.errorMessage ?? undefined}
                      >
                        {STATUS_LABEL[l.status] ?? l.status}
                      </span>
                    </td>
                    <td className="text-ink-secondary px-4 py-2 tabular-nums">
                      {l.attemptCount === undefined ? '—' : `${l.attemptCount}回`}
                    </td>
                    <td className="text-ink-faint px-4 py-2 tabular-nums">
                      {l.nextRetryAt
                        ? l.nextRetryAt.slice(5, 16).replace('T', ' ').replaceAll('-', '/')
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- 注意 ---- */}
      <section className="bg-canvas-sunken rounded-card border-hairline border p-4">
        <h2 className="text-ink text-sm font-bold">気をつけること</h2>
        <ul className="text-ink-faint mt-2 space-y-1 text-xs leading-relaxed">
          <li>・広告のクリックIDは90日で失効します。それ以降の成果は結びつきません</li>
          <li>
            ・お客様の名前やメールアドレスは送っていません。クリックIDと成果の名前だけを送ります
          </li>
          <li>・重複を防ぐ記録と再試行時刻は保持します。実送信への接続は別途確認します</li>
          <li>・広告を使っていない場合、この機能はオフのままで問題ありません</li>
        </ul>
      </section>
    </div>
  )
}
