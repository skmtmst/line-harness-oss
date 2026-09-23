// @vitest-environment happy-dom
/*
 * useUnsavedGuard の回帰テスト（FORM-19系）。
 *
 * - dirty の間、画面内リンク（一覧へのパンくず含む）を止めて確認へ出す
 * - 「保存せずに移動」は onDiscard を呼んでから移動する——同じページ内の
 *   クエリ遷移（コンポーネントが外れない）でも「消えます」の約束を守るため
 * - 同じパス・同じクエリで hash だけ変わる移動は画面内ジャンプなので止めない
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUnsavedGuard } from './use-unsaved-guard'

const router = vi.hoisted(() => ({ push: vi.fn() }))
const discard = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}))

function Harness({ dirty, onDiscard }: { dirty: boolean; onDiscard?: () => void }) {
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, onDiscard })
  return (
    <div>
      <a href="/form-submissions">回答フォーム</a>
      <a href="/form-submissions/edit?id=form-1&tab=design">デザイン設定</a>
      <a href="#section-jump">見出し</a>
      {leaveTarget ? (
        <div role="dialog">
          <p>leave:{leaveTarget.kind}:{leaveTarget.kind === 'link' ? leaveTarget.href : ''}</p>
          <button type="button" data-action="confirm" onClick={confirmLeave}>保存せずに移動</button>
          <button type="button" data-action="cancel" onClick={cancelLeave}>編集を続ける</button>
        </div>
      ) : null}
    </div>
  )
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  router.push.mockReset()
  discard.mockReset()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // 現在位置を固定しておく（リンク判定が location 依存のため）。
  window.history.replaceState(null, '', '/form-submissions/edit?id=form-1&tab=basic')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

async function render(ui: React.ReactElement) {
  await act(async () => { root.render(ui) })
}

function anchor(text: string): HTMLAnchorElement {
  const found = [...host.querySelectorAll('a')].find((a) => a.textContent === text)
  expect(found, `リンク「${text}」がある`).toBeTruthy()
  return found!
}

async function click(target: Element): Promise<MouseEvent> {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
  await act(async () => { target.dispatchEvent(event) })
  return event
}

async function clickDialogButton(action: 'confirm' | 'cancel') {
  const button = host.querySelector(`[data-action="${action}"]`)!
  expect(button, `${action} ボタンがある`).toBeTruthy()
  await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

describe('useUnsavedGuard', () => {
  it('dirty の間、一覧へのリンクを止めて確認を出す（FORM-19a）', async () => {
    await render(<Harness dirty={true} />)
    const event = await click(anchor('回答フォーム'))
    expect(event.defaultPrevented).toBe(true)
    expect(host.textContent).toContain('leave:link:/form-submissions')
    expect(router.push).not.toHaveBeenCalled()
  })

  it('「保存せずに移動」は捨てる処理を呼んでから移動する（FORM-19b）', async () => {
    const order: string[] = []
    discard.mockImplementation(() => { order.push('discard') })
    router.push.mockImplementation(() => { order.push('push') })
    await render(<Harness dirty={true} onDiscard={discard} />)
    await click(anchor('回答フォーム'))
    await clickDialogButton('confirm')
    expect(discard).toHaveBeenCalledTimes(1)
    expect(router.push).toHaveBeenCalledWith('/form-submissions')
    // 破棄が先。移動後に戻しても「消えます」の約束が守れるようにするため。
    expect(order).toEqual(['discard', 'push'])
  })

  it('同じページ内のクエリ遷移でも確認→破棄→移動になる', async () => {
    await render(<Harness dirty={true} onDiscard={discard} />)
    const event = await click(anchor('デザイン設定'))
    expect(event.defaultPrevented).toBe(true)
    expect(host.textContent).toContain('leave:link:/form-submissions/edit?id=form-1&tab=design')
    await clickDialogButton('confirm')
    expect(discard).toHaveBeenCalledTimes(1)
    expect(router.push).toHaveBeenCalledWith('/form-submissions/edit?id=form-1&tab=design')
  })

  it('「編集を続ける」は移動も破棄もしない', async () => {
    await render(<Harness dirty={true} onDiscard={discard} />)
    await click(anchor('回答フォーム'))
    await clickDialogButton('cancel')
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(router.push).not.toHaveBeenCalled()
    expect(discard).not.toHaveBeenCalled()
  })

  it('未変更ならリンクはそのまま通す', async () => {
    await render(<Harness dirty={false} onDiscard={discard} />)
    const event = await click(anchor('回答フォーム'))
    expect(event.defaultPrevented).toBe(false)
    expect(host.querySelector('[role="dialog"]')).toBeNull()
  })

  it('パスとクエリが同じで hash だけ変わる移動は止めない', async () => {
    await render(<Harness dirty={true} />)
    const event = await click(anchor('見出し'))
    expect(event.defaultPrevented).toBe(false)
    expect(host.querySelector('[role="dialog"]')).toBeNull()
  })
})
