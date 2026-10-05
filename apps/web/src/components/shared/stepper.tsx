'use client'

import React from 'react'

export type StepperState = 'done' | 'current' | 'todo' | 'attention'

/** 旧名。Stepper に寄せたので、新しくは StepperState を使う。 */
export type StepState = StepperState

export interface StepperStep {
  /** 省略時は label を使う。同名の段が並ぶときだけ付ける。 */
  key?: string
  label: string
  /** 1始まりの表示番号。省略時は上からの順番。 */
  order?: number
  /**
   * 入力が済んだか（done／まだか todo／直すところがあるか attention）。
   * 「いまいる所」はここでは決めない。`currentKey`（段の居場所）と分ける（設計 C）。
   * `currentKey` を渡さない昔の呼び方は、そのまま state の `current` を居場所にする。
   */
  state: StepperState
  /** 押したときに飛ぶ節の id。済み・要修正の段だけに付ける。 */
  anchor?: string
  /** anchor の代わりに押したときの動き。済み・要修正の段だけに付ける。 */
  onSelect?: () => void
}

/**
 * 手順の進み表示（★V7 共通部品その2 `uR9s8` §4・「監査の直し」設計 C）。
 *
 * - 入力済みはチェック（緑の丸＋白の ✓）。押すと戻れる
 * - いまいる所は白地に緑の太い輪＋番号・名前は太字（読み上げ「現在の手順」）
 * - まだは灰色の丸＋番号
 * - 直すところがある段は琥珀色の △。押すとその手順へ戻る
 * - 「次へ」で進んだら、いまいる所の印は必ず進んだ先に付く（入力済みの数で決めない）
 */
export default function Stepper({
  steps,
  label,
  currentKey,
  tone = 'default',
}: {
  /** 何の進みか（例：「配信作成の進み」）。nav の読み上げ名。 */
  label: string
  steps: ReadonlyArray<StepperStep>
  /**
   * いまいる段の key（例：URL の `?step=`）。
   * 渡すと居場所はここで決まり、state は「入力済みか」だけを表す。
   * 渡さないときは state の `current` を居場所にする（昔の呼び方）。
   */
  currentKey?: string
  /**
   * 見た目。既定は緑の ✓（28px）。'mono' は黒丸・番号・約22px
   * （If9Mh 予約の入力：いまいる所も済みも黒丸＋番号、まだは枠線）。
   */
  tone?: 'default' | 'mono'
}) {
  const mono = tone === 'mono'
  return (
    <nav aria-label={label} data-part="stepper" className="border-hairline bg-canvas rounded-card mb-4 border p-4">
      <ol data-design="Steps" aria-label={label} className="flex flex-wrap items-center gap-y-3">
        {steps.map((raw, index) => {
          const step = { ...raw, key: raw.key ?? raw.label, order: raw.order ?? index + 1 }
          const isCurrent = currentKey !== undefined
            ? step.key === currentKey
            : step.state === 'current'
          const filled = step.state === 'done'
          const needsFix = step.state === 'attention'
          const clickable = (filled || needsFix) && !isCurrent && (step.anchor || step.onSelect)
          const circle = (
            <span
              className={`flex shrink-0 items-center justify-center rounded-pill text-xs font-medium ${mono ? 'h-[22px] w-[22px]' : 'h-7 w-7'} ${
                filled
                  ? mono
                    ? 'bg-ink text-canvas'
                    : isCurrent
                      ? 'bg-accent-deep text-on-accent outline-accent-deep outline-2 outline-offset-2'
                      : 'bg-accent-deep text-on-accent'
                  : needsFix
                    ? 'bg-warning-bg text-warning'
                    : isCurrent
                      ? mono
                        ? 'bg-ink text-canvas'
                        : 'bg-canvas text-accent-deep outline-accent-deep outline-2'
                      : 'border-hairline text-ink-faint border'
              }`}
              title={needsFix ? '直すところがあります' : undefined}
            >
              {filled && !mono ? '✓' : needsFix ? <span aria-hidden="true">△</span> : step.order}
              {needsFix ? <span className="sr-only">（直すところあり）</span> : null}
            </span>
          )
          const text = (
            <span className="min-w-0">
              <span
                className={`block truncate text-sm ${
                  isCurrent ? 'text-ink font-bold' : step.state === 'todo' ? 'text-ink-faint' : 'text-ink'
                }`}
              >
                {step.label}
              </span>
            </span>
          )
          return (
            <li key={step.key} className="flex min-w-0 flex-1 items-center gap-3">
              {index > 0 ? (
                <span
                  aria-hidden
                  className={`hidden h-px w-6 shrink-0 sm:block ${
                    steps[index - 1].state === 'done' ? 'bg-accent-deep' : 'bg-hairline'
                  }`}
                />
              ) : null}
              {clickable ? (
                <button
                  type="button"
                  onClick={() => {
                    if (step.onSelect) {
                      step.onSelect()
                      return
                    }
                    if (step.anchor) {
                      document.getElementById(step.anchor)?.scrollIntoView({ block: 'start' })
                    }
                  }}
                  aria-label={`${step.label}へ戻る`}
                  className="flex min-w-0 items-center gap-2 text-left"
                >
                  {circle}
                  {text}
                </button>
              ) : (
                <span
                  className="flex min-w-0 items-center gap-2"
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  {circle}
                  {text}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
