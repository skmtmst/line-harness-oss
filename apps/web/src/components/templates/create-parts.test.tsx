// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreatePreviewNote, CreateStarterCards, CreateSummaryCard } from './create-parts'

afterEach(cleanup)

describe('作る画面の共通の形（K7HWG・VE1u5 の作り）', () => {
  it('設定内容の箱は題と行を出す', () => {
    render(<CreateSummaryCard rows={[{ label: '状態', value: '停止中' }, { label: '動く順番', value: 'いちばん下（6番目）' }]} />)
    expect(screen.getByRole('heading', { name: '設定内容' })).toBeTruthy()
    expect(screen.getByText('停止中')).toBeTruthy()
    expect(screen.getByText('いちばん下（6番目）')).toBeTruthy()
  })

  it('案内は箱の外に出る', () => {
    render(<CreatePreviewNote>LINEでの見え方は次の手順から出ます。</CreatePreviewNote>)
    expect(screen.getByText('LINEでの見え方は次の手順から出ます。').closest('[data-part="create-summary"]')).toBeNull()
  })

  it('ひな形のカードは押すと onUse を呼び、行は全文を title に持つ', () => {
    const onUse = vi.fn()
    render(<CreateStarterCards items={[{ key: 'a', name: '契約更新のお知らせ', lines: ['契約終了日・30日前 10:00'], onUse }]} />)
    expect(screen.getByText('契約終了日・30日前 10:00').getAttribute('title')).toBe('契約終了日・30日前 10:00')
    fireEvent.click(screen.getByRole('button', { name: 'このひな形を使う' }))
    expect(onUse).toHaveBeenCalledTimes(1)
  })

  it('寸法は型の変数だけを読む（数字の直書きをしない）', () => {
    const css = readFileSync(join(__dirname, 'create-parts.module.css'), 'utf8')
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '')
    expect(body).not.toMatch(/(?:padding|gap|line-height|font-size|min-height)\s*:\s*\d/)
  })
})
