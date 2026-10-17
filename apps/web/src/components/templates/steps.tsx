'use client'

import { Check, Circle, CircleCheck, CircleDot } from 'lucide-react'
import type { StepperStep } from '@/components/shared/stepper'
import styles from './steps.module.css'

export type { StepperStep as StepsStep } from '@/components/shared/stepper'

type DotState = 'done' | 'current' | 'todo' | 'attention'

/**
 * ★V8 の手順（共通部品 Fa8ED「手順（共通・題と説明の下・左寄せ）」・決まりの板 q1xNMz。2026-10-08 オーナー）。
 *
 * - 置き場所：作る画面の題と説明のすぐ下・左寄せ・1行（型の PageHeading の `steps` に渡す）。横いっぱいに広げない
 * - 段：丸24（済み＝緑に白い✓・今＝墨に白い数字・まだ＝薄い枠に灰の数字）・名13（今だけ太字）・段の間に線24
 * - 済みの段（と直すところがある段）は押して戻れる。まだの段・今の段は押せない（reachable の付いたまだの段だけ、番号のまま押して進める）
 * - 入らない幅では各名を1行で省略し、全文は読み上げと title に残す
 *
 * 渡し方は共通の型（label・steps・currentKey）。手順の見た目はこのV8部品だけを使う。
 */
export function Steps({
  label,
  steps,
  currentKey,
  connectorSize,
  layout = 'horizontal',
}: {
  /** 何の進みか（例：「リッチメニューを作る手順」）。nav の読み上げ名。 */
  label: string
  steps: ReadonlyArray<StepperStep>
  /** いまいる段の key（例：URL の `?step=`）。渡さないときは state が current の最初の段。 */
  currentKey?: string
  connectorSize?: 'short'
  /** 窓の左で、回答済み・現在・未回答の質問へ移る列。 */
  layout?: 'horizontal' | 'sidebar'
}) {
  const items = steps.map((raw, index) => ({ ...raw, key: raw.key ?? raw.label, order: raw.order ?? index + 1 }))
  const currentIndex = currentKey !== undefined
    ? items.findIndex((step) => step.key === currentKey)
    : items.findIndex((step) => step.state === 'current')
  const stateOf = (index: number): DotState => {
    if (index === currentIndex) return 'current'
    const state = items[index].state
    return state === 'current' ? 'todo' : state
  }

  if (layout === 'sidebar') return (
    <nav aria-label={label} data-part="steps" data-layout="sidebar" className={styles.root}>
      <ol className={styles.sidebarList}>
        {items.map((step, index) => {
          const state = stateOf(index)
          const Icon = state === 'current' ? CircleDot : state === 'done' ? CircleCheck : Circle
          return <li key={step.key} aria-current={state === 'current' ? 'step' : undefined}>
            <button type="button" className={styles.sidebarStep} data-state={state} onClick={step.onSelect} disabled={!step.onSelect}>
              <Icon aria-hidden="true" className={styles.sidebarIcon} /><span className={styles.sidebarName}>{step.label}</span>
            </button>
          </li>
        })}
      </ol>
    </nav>
  )

  return (
    <nav aria-label={label} data-part="steps" data-connector-size={connectorSize} className={styles.root}>
      <ol className={styles.list} data-design="Steps">
        {items.map((step, index) => {
          const state = stateOf(index)
          const isCurrent = state === 'current'
          const forward = state === 'todo' && step.reachable === true
          const clickable = (state === 'done' || state === 'attention' || forward) && Boolean(step.anchor || step.onSelect)
          const lineDone = index > 0 && stateOf(index - 1) === 'done'
          const dot = (
            <span className={styles.dot} data-step-dot={state} title={state === 'attention' ? '直すところがあります' : undefined}>
              {state === 'done'
                ? <><Check className={styles.check} aria-hidden="true" strokeWidth={2.5} /><span className={styles.srOnly}>済み</span></>
                : state === 'attention'
                  ? <><span aria-hidden="true">△</span><span className={styles.srOnly}>直すところあり</span></>
                  : step.order}
            </span>
          )
          const name = <span className={styles.name} data-step-name={state}>{step.label}</span>
          return (
            <li key={step.key} className={styles.item} data-step-state={state}>
              {index > 0 ? <span aria-hidden="true" className={styles.line} data-step-line={lineDone ? 'done' : 'todo'} /> : null}
              {clickable ? (
                <button
                  type="button"
                  className={styles.step}
                  title={step.label}
                  aria-label={`${step.label}に${forward ? '進む' : '戻る'}`}
                  onClick={() => {
                    if (step.onSelect) {
                      step.onSelect?.()
                      return
                    }
                    if (step.anchor) document.getElementById(step.anchor)?.scrollIntoView({ block: 'start' })
                  }}
                >
                  {dot}
                  {name}
                </button>
              ) : (
                <span className={styles.step} title={step.label} aria-current={isCurrent ? 'step' : undefined}>
                  {dot}
                  {name}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
