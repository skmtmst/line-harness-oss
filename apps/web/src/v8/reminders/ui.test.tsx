// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ArrowRight } from 'lucide-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PhoneV8, WizardFooterV8 } from './ui'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
afterEach(cleanup)

describe('リマインダの下見と次の操作', () => {
  it('見本の説明は常設せず「？」から開く', () => {
    render(<PhoneV8 accountName="本店" message="山田花子さん" hasSampledBody />)
    expect(screen.queryByText('名前や日時は見本の値です。')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'LINEでの見え方の説明' }))
    expect(screen.getByRole('note').textContent).toBe('名前や日時は見本の値です。')
    expect(screen.getByText('山田花子さん')).toBeTruthy()
  })

  it.each([
    { empty: true, hasSampledBody: true },
    { empty: false, hasSampledBody: false },
  ])('本文がない状態や見本でない状態には説明を出さない（%j）', (props) => {
    render(<PhoneV8 accountName="本店" {...props} />)
    expect(screen.queryByRole('button', { name: 'LINEでの見え方の説明' })).toBeNull()
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('次へ進む矢印を文字の後ろに置き、一度の操作で次へ進む', () => {
    const next = vi.fn()
    render(<WizardFooterV8 onCancel={vi.fn()} onNext={next} nextLabel="確認へ" nextIcon={<ArrowRight />} />)
    const button = screen.getByRole('button', { name: '確認へ' })
    const icon = button.querySelector('svg')!
    expect(button.textContent).toBe('確認へ')
    expect(icon.previousSibling?.textContent?.trim()).toBe('確認へ')
    fireEvent.click(button)
    expect(next).toHaveBeenCalledTimes(1)
  })
})
