// @vitest-environment happy-dom
/*
 * useUnsavedGuard の回帰テスト（FORM-19系）。
 *
 * - dirty の間、画面内リンク（一覧へのパンくず含む）を止めて確認へ出す
 * - 「保存せずに移る」は onDiscard を呼んでから移動する——同じページ内の
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

function Harness({ dirty, onDiscard, busy, disarmBeforeConfirm }: { dirty: boolean; onDiscard?: () => void; busy?: boolean; disarmBeforeConfirm?: boolean }) {
  const { leaveTarget, confirmLeave, cancelLeave, guarded, disarm } = useUnsavedGuard({ dirty, onDiscard, busy })
  return (
    <div>
      <a href="/form-submissions">回答フォーム</a>
      <a href="/form-submissions/edit?id=form-1&tab=design">デザイン設定</a>
      <a href="#section-jump">見出し</a>
      {/* router.push を直接呼ぶボタン（リンクではない離れる操作） */}
      <button type="button" data-action="leave-button" onClick={() => guarded(() => router.push('/broadcasts'))}>
        一覧に戻る
      </button>
      {leaveTarget ? (
        <div role="dialog">
          <p>leave:{leaveTarget.kind}:{leaveTarget.kind === 'link' ? leaveTarget.href : ''}</p>
          <button type="button" data-action="confirm" onClick={() => { if (disarmBeforeConfirm) disarm(); confirmLeave() }}>保存せずに移る</button>
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
  it('2つの未保存状態があっても履歴は1回戻し、1つの確認で両方を破棄する', async () => {
    const parentDiscard = vi.fn(), childDiscard = vi.fn()
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {})
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    try {
      await render(<><Harness dirty onDiscard={parentDiscard} /><Harness dirty onDiscard={childDiscard} /></>)
      await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')) })
      expect(go).toHaveBeenCalledTimes(1)
      expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1)
      await clickDialogButton('confirm')
      expect(parentDiscard).toHaveBeenCalledTimes(1)
      expect(childDiscard).toHaveBeenCalledTimes(1)
      expect(back).toHaveBeenCalledTimes(1)
    } finally { go.mockRestore(); back.mockRestore() }
  })
  it('履歴確定の直前に解除しても、自分と他の未保存入力を両方破棄する', async () => {
    const parentDiscard = vi.fn(), childDiscard = vi.fn()
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {})
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    try {
      await render(<><Harness dirty onDiscard={parentDiscard} disarmBeforeConfirm /><Harness dirty onDiscard={childDiscard} /></>)
      await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')) })
      await clickDialogButton('confirm')
      expect(parentDiscard).toHaveBeenCalledTimes(1)
      expect(childDiscard).toHaveBeenCalledTimes(1)
      expect(back).toHaveBeenCalledTimes(1)
    } finally { go.mockRestore(); back.mockRestore() }
  })
  it('確認後に別の入力が保存中なら解除を戻して確認を維持する', async () => {
    const firstDiscard = vi.fn(), otherDiscard = vi.fn()
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {})
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    try {
      await render(<><Harness dirty onDiscard={firstDiscard} disarmBeforeConfirm /><Harness dirty onDiscard={otherDiscard} /></>)
      await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')) })
      await render(<><Harness dirty onDiscard={firstDiscard} disarmBeforeConfirm /><Harness dirty busy onDiscard={otherDiscard} /></>)
      await clickDialogButton('confirm')
      expect(firstDiscard).not.toHaveBeenCalled()
      expect(otherDiscard).not.toHaveBeenCalled()
      expect(back).not.toHaveBeenCalled()
      expect(host.querySelector('[role="dialog"]')).toBeTruthy()
      await render(<><Harness dirty onDiscard={firstDiscard} disarmBeforeConfirm /><Harness dirty={false} onDiscard={otherDiscard} /></>)
      const event = await click(anchor('回答フォーム'))
      expect(event.defaultPrevented).toBe(true)
    } finally { go.mockRestore(); back.mockRestore() }
  })
  it('破棄後に再編集して戻る時も、もう一度確認する', async () => {
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {})
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    try {
      await render(<Harness dirty onDiscard={discard} />)
      await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')) })
      await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')) })
      await clickDialogButton('confirm')
      await render(<Harness dirty={false} onDiscard={discard} />)
      await render(<Harness dirty onDiscard={discard} />)
      await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')) })
      expect(go).toHaveBeenCalledTimes(2)
      expect(host.querySelector('[role="dialog"]')).toBeTruthy()
    } finally { go.mockRestore(); back.mockRestore() }
  })
  it('復元後の通知では他の未保存状態も再び止めない', async () => {
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {})
    try {
      await render(<><Harness dirty /><Harness dirty /></>)
      await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')) })
      await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')) })
      expect(go).toHaveBeenCalledTimes(1)
      expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    } finally { go.mockRestore() }
  })
  it('復元前に入力がきれいになっても次の戻る操作を確認する', async () => {
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {})
    try {
      await render(<Harness dirty />)
      await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')) })
      await render(<Harness dirty={false} />)
      await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')) })
      await render(<Harness dirty />)
      await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')) })
      expect(go).toHaveBeenCalledTimes(2)
    } finally { go.mockRestore() }
  })
  it('一方が保存中なら別の入力からも履歴を進めない', async () => {
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {})
    try {
      await render(<><Harness dirty /><Harness dirty busy /></>)
      await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')) })
      expect(go).toHaveBeenCalledTimes(1)
      expect(host.querySelector('[role="dialog"]')).toBeNull()
    } finally { go.mockRestore() }
  })
  it('2つの入力で編集を続けると、どちらも破棄しない', async () => {
    const parentDiscard = vi.fn(), childDiscard = vi.fn()
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {})
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    try {
      await render(<><Harness dirty onDiscard={parentDiscard} /><Harness dirty onDiscard={childDiscard} /></>)
      await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')) })
      await clickDialogButton('cancel')
      expect(parentDiscard).not.toHaveBeenCalled()
      expect(childDiscard).not.toHaveBeenCalled()
      expect(back).not.toHaveBeenCalled()
    } finally { go.mockRestore(); back.mockRestore() }
  })
  it('保存中は未保存判定にかかわらず閉じる操作を止める', async () => {
    await render(<Harness dirty={false} busy />)
    await act(async () => host.querySelector<HTMLButtonElement>('[data-action="leave-button"]')!.click())
    expect(router.push).not.toHaveBeenCalled()
  })
  it('dirty の間、一覧へのリンクを止めて確認を出す（FORM-19a）', async () => {
    await render(<Harness dirty={true} />)
    const event = await click(anchor('回答フォーム'))
    expect(event.defaultPrevented).toBe(true)
    expect(host.textContent).toContain('leave:link:/form-submissions')
    expect(router.push).not.toHaveBeenCalled()
  })

  it('「保存せずに移る」は捨てる処理を呼んでから移動する（FORM-19b）', async () => {
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

  it('リンクではない離れる操作も dirty の間は止めて確認を出す', async () => {
    await render(<Harness dirty={true} onDiscard={discard} />)
    const button = host.querySelector('[data-action="leave-button"]')!
    await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    // 操作は保留され、まだ動いていない
    expect(router.push).not.toHaveBeenCalled()
    expect(host.textContent).toContain('leave:action')
    // 「保存せずに移る」で保留していた操作が実行される
    await clickDialogButton('confirm')
    expect(discard).toHaveBeenCalledTimes(1)
    expect(router.push).toHaveBeenCalledWith('/broadcasts')
  })

  it('未変更ならリンクではない操作もそのまま実行する', async () => {
    await render(<Harness dirty={false} />)
    const button = host.querySelector('[data-action="leave-button"]')!
    await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(router.push).toHaveBeenCalledWith('/broadcasts')
    expect(host.querySelector('[role="dialog"]')).toBeNull()
  })
})

it('同じ正規画面の互換リンクは確認せず、別画面は確認する', async () => {
  window.history.replaceState(null, '', '/conversions?tab=points')
  await render(<Harness dirty />)
  const link = anchor('回答フォーム')
  link.href = '/affiliates?tab=points#list'
  await act(async () => { link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  link.href = '/friends'
  await act(async () => { link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
  expect(host.querySelector('[role="dialog"]')).toBeTruthy()
})
