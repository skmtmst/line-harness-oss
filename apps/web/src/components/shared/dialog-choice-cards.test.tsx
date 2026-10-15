// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DialogChoiceCards from './dialog-choice-cards'

describe('作成画面へ進む選択カード', () => {
  it('全種類の行き先と説明を保持し、通常クリックだけを画面内で開く', () => {
    const onChoose = vi.fn()
    const choices = Array.from({ length: 7 }, (_, index) => ({
      key: `kind-${index}`, title: `種類${index}`, icon: null,
      description: `説明${index}`, notes: ['使う場面', '使えない場面'], href: `/templates/edit?kind=${index}`,
    }))
    render(<DialogChoiceCards choices={choices} onChoose={onChoose} />)
    expect(screen.getAllByRole('link')).toHaveLength(7)
    for (const choice of choices) {
      const link = screen.getByRole('link', { name: choice.title })
      expect(link.getAttribute('href')).toBe(choice.href)
      expect(document.getElementById(link.getAttribute('aria-describedby')!)?.textContent).toContain(choice.description)
      fireEvent.click(link)
      expect(onChoose).toHaveBeenLastCalledWith(choice.href)
    }
    onChoose.mockClear()
    const link = screen.getByRole('link', { name: '種類0' })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })
    link.dispatchEvent(event)
    expect(onChoose).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })
})
