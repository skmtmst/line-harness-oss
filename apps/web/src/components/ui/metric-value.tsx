import React from 'react'

/**
 * 指標カードの数字（監査6 #674「数字の見せ方統一」）。
 *
 * 画面ごとにバラバラだった数値の見せ方を、この1部品へ寄せる。
 * ルールは次の4つ:
 *
 * 1. **tabular-nums** — 桁が変わってもレイアウトが揺れないよう
 *    `font-variant-numeric: tabular-nums` を必ず付ける。
 * 2. **数字=大・単位=小** — 単位（件・人・回・時間など）は数字より
 *    小さく薄く出す。`unit` とは別に `prefix`（「およそ」など）も
 *    同じ大きさで数字の前に置ける。
 * 3. **24px超は字詰め** — 数字が24pxを超える大きさ（text-3xl など）の
 *    ときは `large` を付け、`letter-spacing: -0.02em` を足す。
 *    text-2xl（24pxちょうど）以下には付けない。
 * 4. **3状態の区別** —
 *    - `—` … 値が取れていない（未取得・読み込み失敗）。薄い色、単位は付けない。
 *    - `0` … 実測・集計の結果ゼロ。ふつうの色、単位を付ける。
 *    - エラー … `—` で出し、理由は呼び出し側の補足行へ
 *      （「取得できませんでした」＋再試行）。`state="error"` で
 *      `data-metric-state` に記録する。
 *
 * 使い方: カードの値の行（`text-2xl font-bold` の `<p>` など）の中へ置く。
 * ```tsx
 * <p className="mt-1 text-2xl font-bold text-ink">
 *   <MetricValue value={count} unit="件" />
 * </p>
 * ```
 */
export default function MetricValue({
  value,
  text,
  unit,
  prefix,
  large = false,
  state,
  className,
}: {
  /** 実値。null・undefined・非数は「未取得」として `—` を出す。0 は実値。 */
  value?: number | null
  /**
   * 数でない表記（「12.3」「4.5」など呼び出し側で整形済みの文字）を
   * そのまま出す。`value` より優先される。
   */
  text?: string | null
  /** 数字の右に小さく出す単位。「件」「人」「%」など。 */
  unit?: string
  /** 数字の左に小さく出す言葉。「およそ」「約」など。 */
  prefix?: string
  /** 数字が24pxを超えるとき true（letter-spacing: -0.02em を足す）。 */
  large?: boolean
  /**
   * 表示状態。省略時は値から決める（値があれば ready、無ければ missing）。
   * 失敗を区別して残したいときだけ `error` を渡す。見た目は missing と
   * 同じ `—` で、差は `data-metric-state` に出る。
   */
  state?: 'ready' | 'missing' | 'error'
  /** 外側の色・サイズ指定に続けて付けるクラス。 */
  className?: string
}) {
  const ready = (text !== undefined && text !== null) || (typeof value === 'number' && Number.isFinite(value))
  const metricState = state ?? (ready ? 'ready' : 'missing')
  // 失敗・未取得は値が残っていても「—」で出す（0 と区別するため）。
  const forcedMissing = state === 'missing' || state === 'error'
  const shown = forcedMissing ? null : (text ?? (typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('ja-JP') : null))
  return (
    <span
      data-metric-state={metricState}
      className={['tabular-nums', large ? 'tracking-[-0.02em]' : null, className].filter(Boolean).join(' ')}
    >
      {shown === null ? (
        <span className="text-ink-faint">—</span>
      ) : (
        <>
          {/* 前置きの後ろは実スペース。コピーや読み上げでも「平均 約1ヶ月」と取れるように。 */}
          {prefix ? <span className="text-xs font-normal text-ink-faint">{prefix} </span> : null}
          {shown}
          {unit ? <span className="ml-0.5 text-xs font-normal text-ink-faint">{unit}</span> : null}
        </>
      )}
    </span>
  )
}
