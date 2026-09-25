'use client'

/**
 * 運営ダッシュボード（★V6 37-2）の絵。棒グラフ `月ごとの売上` とドーナツ `プラン別の契約`。
 *
 * 色は CSS の色トークンだけを使う（Pencil のトークン表に無い色は作らない）。
 * - 今月の棒: accent-deep ／ 過去の棒: surface-pearl
 * - ライト: status-info ／ スタンダード: ink ／ プロ: chip-alt ／ トライアル: status-warn
 * プランの分類色に緑は使わない（緑は「正常」の意味だけ）。
 */

export function formatYen(yen: number): string {
  // 数字でない値が来ても「¥NaN」を出さない。未取得は「—」が決まり。
  if (typeof yen !== 'number' || !Number.isFinite(yen)) return '—'
  return `¥${Math.round(yen).toLocaleString('ja-JP')}`
}

/** 軸の目盛り。¥450万 のように「万」で丸める。 */
export function formatYenShort(yen: number): string {
  if (yen === 0) return '¥0'
  if (yen >= 10_000) return `¥${Math.round(yen / 10_000).toLocaleString('ja-JP')}万`
  return formatYen(yen)
}

/** 目盛りの上限。最大値の少し上を「切りのいい万円」で。 */
export function niceCeiling(max: number): number {
  if (max <= 0) return 100_000
  const step = 10 ** Math.floor(Math.log10(max))
  const candidates = [1, 1.5, 2, 3, 4, 5, 6, 8, 10].map((k) => k * step)
  return candidates.find((c) => c >= max) ?? max
}

export function RevenueBars({ rows, width = 920, height = 220 }: { rows: Array<{ label: string; yen: number; current: boolean }>; width?: number; height?: number }) {
  const left = 64
  const bottom = 28
  const top = 32
  const plotW = width - left - 16
  const plotH = height - top - bottom
  const ceiling = niceCeiling(Math.max(...rows.map((r) => r.yen), 0))
  const ticks = [1, 2 / 3, 1 / 3, 0].map((k) => ceiling * k)
  const slot = rows.length > 0 ? plotW / rows.length : plotW
  const barW = Math.min(122, slot * 0.7)
  const current = rows.find((r) => r.current)
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={`月ごとの売上。${rows.map((r) => `${r.label} ${formatYen(r.yen)}`).join('、')}`}>
      {ticks.map((t, i) => {
        const y = top + plotH - (ceiling > 0 ? (t / ceiling) * plotH : 0)
        return (
          <g key={i}>
            <line x1={left} x2={width - 16} y1={y} y2={y} stroke="var(--color-hairline)" strokeWidth={1} />
            <text x={left - 8} y={y + 4} textAnchor="end" fontSize={11} fill="var(--color-ink-faint)">{formatYenShort(t)}</text>
          </g>
        )
      })}
      {rows.map((r, i) => {
        const h = ceiling > 0 ? (r.yen / ceiling) * plotH : 0
        const x = left + slot * i + (slot - barW) / 2
        const y = top + plotH - h
        return (
          <g key={r.label}>
            <rect x={x} y={y} width={barW} height={Math.max(h, 0)} rx={6} fill={r.current ? 'var(--color-accent-deep)' : 'var(--color-surface-pearl)'} stroke={r.current ? 'none' : 'var(--color-hairline)'} />
            <text x={x + barW / 2} y={height - 8} textAnchor="middle" fontSize={12} fill="var(--color-ink-secondary)">{r.label}</text>
            {r.current && current ? (
              <g>
                <rect x={x + barW / 2 - 44} y={Math.max(y - 30, 2)} width={88} height={24} rx={6} fill="var(--color-ink)" />
                <text x={x + barW / 2} y={Math.max(y - 30, 2) + 16} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--color-on-accent)">{formatYen(current.yen)}</text>
              </g>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}

const SHARE_COLORS: Record<string, string> = {
  light: 'var(--color-status-info)',
  standard: 'var(--color-ink)',
  pro: 'var(--color-chip-alt)',
  trial: 'var(--color-status-warn)',
}

export function shareColor(key: string): string {
  return SHARE_COLORS[key] ?? 'var(--color-ink-faint)'
}

/** ドーナツ。合計 0 のときは薄い輪だけ描く。 */
export function PlanDonut({ rows, total, size = 190 }: { rows: Array<{ key: string; count: number }>; total: number; size?: number }) {
  const r = size / 2 - 14
  const c = size / 2
  const circumference = 2 * Math.PI * r
  let offset = 0
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`契約先 ${total} 件の内訳`}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--color-surface-pearl)" strokeWidth={24} />
      {total > 0
        ? rows.filter((row) => row.count > 0).map((row) => {
          const len = (row.count / total) * circumference
          const el = (
            <circle
              key={row.key}
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke={shareColor(row.key)}
              strokeWidth={24}
              strokeDasharray={`${len} ${circumference - len}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${c} ${c})`}
            />
          )
          offset += len
          return el
        })
        : null}
      <text x={c} y={c - 2} textAnchor="middle" fontSize={26} fontWeight={700} fill="var(--color-ink)">{total}</text>
      <text x={c} y={c + 20} textAnchor="middle" fontSize={12} fill="var(--color-ink-secondary)">契約先</text>
    </svg>
  )
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)}GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)}MB`
  return `${Math.round(bytes / 1024)}KB`
}
