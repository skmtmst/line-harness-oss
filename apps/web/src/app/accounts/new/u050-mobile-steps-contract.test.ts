import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('../../../v8/account-new/register.tsx', import.meta.url), 'utf8')
const STEPS = readFileSync(new URL('../../../components/templates/steps.tsx', import.meta.url), 'utf8')
const CSS = readFileSync(new URL('../../../components/templates/steps.module.css', import.meta.url), 'utf8')

describe('アカウント登録のV8の手順表示（#975 U050）', () => {
  it('入らない幅では共通Stepsが現在の手順だけを表示し、他の名前を読み上げに残す', () => {
    expect(PAGE).toContain('<Steps')
    expect(STEPS).toContain('data-compact')
    expect(CSS).toContain(".root[data-compact] .name:not([data-step-name='current'])")
    expect(CSS).toContain('clip: rect(0 0 0 0)')
  })
  it('進み具合を5段の同じ手順で示し、済んだ段へ入力を残して戻れる', () => {
    expect(PAGE).toContain('label="登録の進捗"')
    expect(PAGE).toContain('currentKey={String(createdId ? 5 : currentStep)}')
    expect(PAGE).toContain('steps={V8_STEPS.map')
    expect(PAGE).toContain('onSelect: !createdId && currentStep > step.number')
    expect(CSS).toContain('flex-wrap: nowrap')
  })
})
