// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RsDialog } from './parts'

afterEach(cleanup)

describe('飲食店の窓の操作位置', () => {
  it('指定しない入力窓は操作をform内に保ち、必須入力とsubmitを維持する', () => {
    const save = vi.fn()
    render(<RsDialog open title="入力の確認" width={480} top={200} onCancel={() => {}} onSubmit={save} actions={<button type="submit">保存する</button>}>
      <label>名前<input required /></label>
    </RsDialog>)
    const dialog = screen.getByRole('dialog', { name: '入力の確認' })
    const input = within(dialog).getByRole('textbox') as HTMLInputElement
    const button = within(dialog).getByRole('button', { name: '保存する' }) as HTMLButtonElement
    const form = dialog.querySelector('form')!
    expect(button.form).toBe(form)
    expect(form.checkValidity()).toBe(false)
    fireEvent.click(button)
    expect(save).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '窓口' } })
    expect(form.checkValidity()).toBe(true)
    fireEvent.click(button)
    expect(save).toHaveBeenCalledTimes(1)
    expect(dialog.querySelector('[data-window-actions]')?.childElementCount).toBe(0)
  })

  it('指定した確認窓だけ理由と操作を本文のスクロールから分ける', () => {
    const stop = vi.fn()
    render(<RsDialog open title="対象の確認" width={480} top={200} onCancel={() => {}} actionsPlacement="footer" footerNote={<p>対象を選んでください</p>} actions={<button onClick={stop}>止める</button>}>
      <p>本文</p>
    </RsDialog>)
    const dialog = screen.getByRole('dialog', { name: '対象の確認' })
    const body = dialog.querySelector('[data-window-body]')!
    const footer = dialog.querySelector('[data-window-actions]')!
    expect(within(body as HTMLElement).getByText('本文')).toBeTruthy()
    expect(body.contains(within(dialog).getByRole('button', { name: '止める' }))).toBe(false)
    expect(within(footer as HTMLElement).getByText('対象を選んでください')).toBeTruthy()
    fireEvent.click(within(footer as HTMLElement).getByRole('button', { name: '止める' }))
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('下に続く本文だけ案内し、末尾まで読むと案内を消す', () => {
    render(<RsDialog open title="長い確認" width={480} top={200} onCancel={() => {}} actionsPlacement="footer" actions={<button>止める</button>}>
      <p>選択肢</p>
    </RsDialog>)
    const dialog = screen.getByRole('dialog', { name: '長い確認' })
    const body = dialog.querySelector<HTMLElement>('[data-window-body]')!
    const footer = dialog.querySelector<HTMLElement>('[data-window-actions]')!
    const hint = 'スクロールして続きを確認'
    expect(within(footer).getByText(hint).style.visibility).toBe('hidden')
    Object.defineProperties(body, {
      scrollHeight: { configurable: true, value: 600 },
      clientHeight: { configurable: true, value: 500 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    })
    fireEvent.scroll(body)
    expect(within(footer).getByText(hint).style.visibility).toBe('visible')
    body.scrollTop = 100
    fireEvent.scroll(body)
    expect(within(footer).getByText(hint).style.visibility).toBe('hidden')
    body.scrollTop = 0
    fireEvent.scroll(body)
    expect(within(footer).getByText(hint).style.visibility).toBe('visible')
    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 500 })
    fireEvent.scroll(body)
    expect(within(footer).getByText(hint).style.visibility).toBe('hidden')
  })
})


it('固定footerは共通操作帯の直接の子に操作を置き、理由を操作と別の行にする', () => {
  const close = vi.fn(), stop = vi.fn()
  render(<RsDialog open title="受付の確認" width={480} top={200} onCancel={close} actionsPlacement="footer" footerNote={<p>停止するサービスを選んでください</p>} actions={<><button onClick={close}>閉じる</button><button onClick={stop}>止める</button></>}><p>本文</p></RsDialog>)
  const dialog = screen.getByRole('dialog', { name: '受付の確認' })
  const footer = dialog.querySelector('[data-window-actions]')!
  const actions = footer.querySelector('[data-dialog-actions]')
  expect(actions).not.toBeNull()
  expect(within(footer as HTMLElement).getByRole('button', { name: '閉じる', exact: true }).parentElement).toBe(actions)
  expect(within(dialog).getByRole('button', { name: '止める', exact: true }).parentElement).toBe(actions)
  const note = within(footer as HTMLElement).getByText('停止するサービスを選んでください')
  expect(note.parentElement?.querySelector('button,a')).toBeNull()
  expect(actions?.querySelector('[data-scroll-hint]')?.parentElement).toBe(actions)
})

it('線なしの固定footerだけ余白を窓へ任せ、線ありの既定を保つ', () => {
  const props = { open: true, title: '受付の確認', onCancel: () => {}, actionsPlacement: 'footer' as const, actions: <><button>閉じる</button><button>止める</button></> }
  const first = render(<RsDialog {...props} footerPlain><p>本文</p></RsDialog>)
  expect(screen.getByRole('dialog', { name: '受付の確認' }).querySelector('[data-dialog-actions]')?.getAttribute('data-padding')).toBe('none')
  first.unmount()
  render(<RsDialog {...props}><p>本文</p></RsDialog>)
  expect(screen.getByRole('dialog', { name: '受付の確認' }).querySelector('[data-dialog-actions]')?.getAttribute('data-padding')).toBeNull()
})


it.each([
  ['短い理由', false],
  ['対象の店舗の情報を確認できません。店舗の設定を確かめてから、停止するサービスを選んでください。', false],
  [null, false],
  ['対象を選んでください', true],
] as const)('理由%sとbusy=%sでも説明に操作を混ぜず、固定操作を共通帯に保つ', (reason, busy) => {
  render(<RsDialog open title="固定した確認" width={480} top={200} busy={busy} onCancel={() => {}} actionsPlacement="footer" footerNote={reason ? <p>{reason}</p> : null} actions={<><button disabled={busy}>閉じる</button><button disabled={busy}>{busy ? '停止中…' : '止める'}</button></>}><p>本文</p></RsDialog>)
  const dialog = screen.getByRole('dialog', { name: '固定した確認' })
  const footer = dialog.querySelector('[data-window-actions]')!
  const actions = footer.querySelector('[data-dialog-actions]')!
  expect(actions).not.toBeNull()
  expect(actions.querySelectorAll(':scope > button')).toHaveLength(2)
  if (reason) expect(within(footer as HTMLElement).getByText(reason).parentElement?.querySelector('button,a')).toBeNull()
  else expect(footer.querySelectorAll('p')).toHaveLength(1)
  for (const button of actions.querySelectorAll('button')) expect(button.disabled).toBe(busy)
})
