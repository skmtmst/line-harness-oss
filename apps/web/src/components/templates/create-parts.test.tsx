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

  it('完了の要約でも説明と条件を読め、次の操作を使える', () => {
    const onContinue = vi.fn()
    render(<CreateSummaryCard title="予約を受け付けました" variant="completion"
      completionIcon={<svg data-testid="completion-icon" />} description="内容を確認してください"
      descriptionItems={['日時を確認する', '変更は予約詳細から行う']}
      rows={[{ label: '状態', value: '確定' }]}>
      <button onClick={onContinue}>予約を確認する</button>
    </CreateSummaryCard>)
    expect(screen.getByRole('heading', { name: '予約を受け付けました' })).toBeTruthy()
    expect(screen.getByText('内容を確認してください')).toBeTruthy()
    expect(screen.getByTestId('completion-icon').parentElement?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(['日時を確認する', '変更は予約詳細から行う'])
    expect(screen.getByText('確定')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '予約を確認する' }))
    expect(onContinue).toHaveBeenCalledTimes(1)
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
