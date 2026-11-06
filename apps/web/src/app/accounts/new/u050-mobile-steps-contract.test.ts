// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { Steps } from '@/components/templates/steps'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const CSS = readFileSync(join(__dirname, '../../../components/templates/steps.module.css'), 'utf8')

afterEach(cleanup)

/*
 * 登録画面が5段を「登録の進捗」で出し、済んだ段へ戻れて登録後は戻れないことは
 * register-v8-react.test.tsx が描いて押して確かめる。ここは共通の段の部品の描き方と、狭い幅で折り返さない決まり。
 */
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
  it('狭い幅でも段を折り返さない', () => {
    expect(CSS).toContain('flex-wrap: nowrap')
  })
})
