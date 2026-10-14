// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { Steps } from '@/components/templates/steps'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(__dirname, '../../../v8/account-new/register.tsx'), 'utf8')
const CSS = readFileSync(join(__dirname, '../../../components/templates/steps.module.css'), 'utf8')

afterEach(cleanup)

describe('アカウント登録のV8の手順表示（#975 U050）', () => {
  it('現在の段と全段の名前を描画し、省略される名前も全文を読める', () => {
    const labels = ['基本情報', 'LINE設定', '接続確認', '動作確認', '完了']
    render(React.createElement(Steps, {
      label: '登録の進捗',
      currentKey: '2',
      steps: labels.map((label, index) => ({ key: String(index + 1), label, state: index === 0 ? 'done' as const : 'todo' as const })),
    }))
    const nav = screen.getByRole('navigation', { name: '登録の進捗' })
    expect(within(nav).getAllByRole('listitem')).toHaveLength(5)
    expect(nav.querySelector('[aria-current="step"]')?.textContent).toContain(labels[1])
    for (const label of labels) {
      expect(within(nav).getByText(label)).toBeTruthy()
      expect(within(nav).getByTitle(label)).toBeTruthy()
    }
    expect(nav.querySelectorAll('[data-step-dot]')).toHaveLength(5)
  })
  it('進み具合を5段の同じ手順で示し、済んだ段へ入力を残して戻れる', () => {
    expect(PAGE).toContain('label="登録の進捗"')
    expect(PAGE).toContain('currentKey={String(createdId ? 5 : currentStep)}')
    expect(PAGE).toContain('steps={V8_STEPS.map')
    expect(PAGE).toContain('onSelect: !createdId && currentStep > step.number')
    expect(CSS).toContain('flex-wrap: nowrap')
  })
})
