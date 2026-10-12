import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const STEPS = readFileSync(join(HERE, '../../../components/templates/steps.tsx'), 'utf8')
const CSS = readFileSync(join(HERE, '../../../components/templates/steps.module.css'), 'utf8')
const FORM = readFileSync(join(HERE, '../../../components/broadcasts/broadcast-form.tsx'), 'utf8')

/* #973 U048: 段名を狭い幅へ無理に押し込み、折り返しで読めなくしない。 */
describe('配信作成の手順表示（#973 U048）', () => {
  it('狭い幅では現在の段の名前を残し、ほかは番号と読み上げ名を保つ', () => {
    expect(STEPS).toContain('data-compact={compact')
    expect(STEPS).toContain('title={step.label}')
    expect(CSS).toMatch(/\[data-compact\] \.name:not\(\[data-step-name='current'\]\)[^}]*clip:\s*rect\(0 0 0 0\)/s)
    expect(CSS).toMatch(/white-space:\s*nowrap/)
  })
  it('済みの段へ戻れ、次は現在の下の操作から進む', () => {
    expect(STEPS).toContain("state === 'done' || state === 'attention'")
    expect(STEPS).toContain('step.onSelect?.()')
    expect(FORM).toContain('goToStep(stepOrder[Math.min(currentStepIndex + 1, stepOrder.length - 1)])')
    expect(FORM).toContain("currentStep !== 'confirm'")
  })
  it('広い幅では同じ現役の共通部品へ5段とURLの現在地を渡す', () => {
    expect(FORM).toContain('label="配信作成の進み" steps={steps} currentKey={currentStep ?? undefined}')
    expect(STEPS).toContain('<ol')
    expect(STEPS).toContain('aria-current={isCurrent')
  })
})
