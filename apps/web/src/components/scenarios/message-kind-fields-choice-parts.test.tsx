// @vitest-environment happy-dom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { STICKER_LABELS } from '@/components/shared/composer-stickers'
import MessageKindFields, { emptyMessageKindState, serializeMessageKind, type MessageKindState } from './message-kind-fields'

afterEach(cleanup)
const initial = () => ({ ...emptyMessageKindState(), sticker: { packageId: '446', stickerId: '1988' } })
let last: MessageKindState
function Host({ value = initial(), composer = false }: { value?: MessageKindState; composer?: boolean }) {
  const [state, setState] = useState(value)
  last = state
  return <MessageKindFields kind="sticker" value={state} onChange={setState} composer={composer} />
}
const mode = () => within(screen.getByRole('group', { name: 'スタンプの決め方' }))

describe('スタンプ欄は共通の切り替えと選択を使う', () => {
  it('一覧と番号の2択は群として読め、切り替えても常に1つだけ選ばれる', () => {
    render(<Host />)
    const pick = mode().getByRole('button', { name: '一覧から選ぶ' })
    const manual = mode().getByRole('button', { name: '番号を直接入れる' })
    expect(pick.getAttribute('aria-pressed')).toBe('true')
    expect(manual.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(manual)
    expect(manual.getAttribute('aria-pressed')).toBe('true')
    expect(pick.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('textbox', { name: 'パッケージID' })).toBeTruthy()
    fireEvent.click(pick)
    expect(pick.getAttribute('aria-pressed')).toBe('true')
    expect(manual.getAttribute('aria-pressed')).toBe('false')
    expect(last.sticker).toEqual(initial().sticker)
  })

  it('共通の切り替えサイズと、シナリオ指定時だけ付く独立した欄のIDを確かめる', () => {
    const view = render(<Host />)
    expect(mode().getByRole('button', { name: '一覧から選ぶ' }).closest('[data-segmented-control]')?.getAttribute('data-size')).toBe('sticker')
    fireEvent.click(mode().getByRole('button', { name: '番号を直接入れる' }))
    const ids = [...view.container.querySelectorAll('[id]')].map(node => node.id)
    expect(new Set(ids).size).toBe(ids.length)
    const packageId = screen.getByRole('textbox', { name: 'パッケージID' }) as HTMLInputElement
    const stickerId = screen.getByRole('textbox', { name: 'スタンプID' }) as HTMLInputElement
    expect(packageId.id).not.toBe(stickerId.id)
    expect(packageId.labels?.[0]?.textContent).toContain('パッケージID')
    expect(stickerId.labels?.[0]?.textContent).toContain('スタンプID')
    expect(view.container.querySelectorAll('[data-required-badge]').length).toBe(2)
    view.rerender(<Host composer />)
    expect(mode().getByRole('button', { name: '番号を直接入れる' }).closest('[data-segmented-control]')?.getAttribute('data-size')).toBe('sticker')
    expect(screen.queryByRole('radio')).toBeNull()
    expect(view.container.querySelectorAll('[data-required-badge]').length).toBe(0)
    expect(view.container.querySelectorAll('[role=alert]').length).toBe(0)
  })

  it('以前の12枚すべてを選べ、共通の選択は同じIDだけを保存する', () => {
    render(<Host />)
    const packs = [
      { name: 'ムーン', packageId: '446', ids: ['1988','1989','1990','1991','1992','1993','2000','2001'] },
      { name: 'サリー', packageId: '789', ids: ['10855','10856','10857','10877'] },
    ]
    for (const pack of packs) {
      fireEvent.click(screen.getByRole('button', { name: pack.name }))
      for (const stickerId of pack.ids) {
        const button = screen.getByRole('button', { name: STICKER_LABELS[stickerId] })
        fireEvent.click(button)
        expect(button.getAttribute('aria-pressed')).toBe('true')
        expect(JSON.parse(serializeMessageKind('sticker', last)!)).toEqual({ packageId: pack.packageId, stickerId })
        expect(last.location).toEqual(initial().location)
      }
    }
  })

  it('一覧に無い保存済み番号も読み戻し、手入力で直して切り替えても残る', () => {
    render(<Host value={{ ...initial(), sticker: { packageId: 'custom-package', stickerId: 'custom-sticker' } }} />)
    expect(mode().getByRole('button', { name: '番号を直接入れる' }).getAttribute('aria-pressed')).toBe('true')
    const packageId = screen.getByRole('textbox', { name: 'パッケージID' }) as HTMLInputElement
    const stickerId = screen.getByRole('textbox', { name: 'スタンプID' }) as HTMLInputElement
    expect(packageId.value).toBe('custom-package')
    expect(stickerId.value).toBe('custom-sticker')
    fireEvent.change(packageId, { target: { value: '446' } })
    fireEvent.change(stickerId, { target: { value: '1989' } })
    fireEvent.click(mode().getByRole('button', { name: '一覧から選ぶ' }))
    expect(screen.getByRole('button', { name: 'うれしい' }).getAttribute('aria-pressed')).toBe('true')
    expect(JSON.parse(serializeMessageKind('sticker', last)!)).toEqual({ packageId: '446', stickerId: '1989' })
  })
  it.each(Object.entries(STICKER_LABELS))('保存済みの %s は最初から選択済みで名前も読める', (stickerId, label) => {
    render(<Host value={{ ...initial(), sticker: { packageId: stickerId.startsWith('108') ? '789' : '446', stickerId } }} />)
    expect(screen.getByRole('button', { name: label }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText(new RegExp(`選んだスタンプ：${label}`))).toBeTruthy()
  })

  it('開いたまま下書きの値が替わると、対応するパックの選択印へ追従する', () => {
    const view = render(<MessageKindFields kind="sticker" value={initial()} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'にっこり' }).getAttribute('aria-pressed')).toBe('true')
    view.rerender(<MessageKindFields kind="sticker" value={{ ...initial(), sticker: { packageId: '789', stickerId: '10855' } }} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'OK' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('シナリオのサリーも代替の画像を試し、失敗しても名前を失わない', () => {
    render(<Host value={{ ...initial(), sticker: { packageId: '789', stickerId: '10855' } }} />)
    const image = screen.getByRole('img', { name: 'OK', exact: true })
    fireEvent.error(image)
    expect(image.getAttribute('src')).toContain('/iPhone/sticker@2x.png')
    fireEvent.error(image)
    expect(screen.getByRole('button', { name: 'OK', exact: true }).textContent).toBe('OK')
  })

})
