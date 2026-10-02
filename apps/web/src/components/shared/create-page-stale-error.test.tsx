// @vitest-environment happy-dom
/*
 * R610: 作成画面の共通骨組み（CreatePage）で、不正な入力で保存を押した後、
 * 正しく直しても古い検証文が残る不具合の回帰試験。
 *
 * 検証文は入力を直した時点で消えること。保存の失敗文（重複・権限・通信）は
 * 送り直すまで直ったか分からないので、入力を変えても残すこと。
 */
import React, { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: fixture.push }),
}))

import CreatePage from './create-page'

function Harness({ onSave }: { onSave: () => Promise<string | void> }) {
  const [code, setCode] = useState('')
  return (
    <CreatePage
      title="試しの作成"
      parent={['一覧', '/items']}
      onSave={onSave}
      validate={() => {
        if (!code.trim()) return 'コードを入力してください'
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(code)) return 'コードは半角英数字・_・ハイフンで1〜64文字にしてください'
        return null
      }}
    >
      <input id="harness-code" value={code} onChange={(e) => setCode(e.target.value)} />
      <p data-testid="preview">{code ? `/r/${code}` : '未入力'}</p>
    </CreatePage>
  )
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  fixture.push.mockClear()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

async function render(onSave: () => Promise<string | void>) {
  await act(async () => { root.render(<Harness onSave={onSave} />) })
}

function saveButton(): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll('button'))
    .find((b) => b.textContent?.trim() === '保存する')
  if (!button) throw new Error('保存ボタンが見つかりません')
  return button as HTMLButtonElement
}

function codeInput(): HTMLInputElement {
  const el = host.querySelector('#harness-code')
  if (!el) throw new Error('#harness-code が見つかりません')
  return el as HTMLInputElement
}

describe('CreatePage の古い検証文（R610）', () => {
  it('不正入力で保存→検証文が出て、正しく直すと保存を押さずに消える', async () => {
    const onSave = vi.fn(async () => 'id-1')
    await render(onSave)

    await act(async () => {
      fireEvent.change(codeInput(), { target: { value: 'bad ref!' } })
    })
    await act(async () => { saveButton().click() })

    expect(onSave).not.toHaveBeenCalled()
    expect(host.textContent).toContain('コードは半角英数字・_・ハイフンで1〜64文字にしてください')

    // 有効な値へ直す。保存は押さない。
    await act(async () => {
      fireEvent.change(codeInput(), { target: { value: 'audit-sample' } })
    })

    expect(host.textContent).not.toContain('コードは半角英数字')
    expect(host.textContent).toContain('/r/audit-sample')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('まだ不正でも理由が変われば、今の理由の文に寄る', async () => {
    await render(vi.fn(async () => 'id-1'))

    await act(async () => { saveButton().click() })
    expect(host.textContent).toContain('コードを入力してください')

    await act(async () => {
      fireEvent.change(codeInput(), { target: { value: 'bad ref!' } })
    })
    expect(host.textContent).not.toContain('コードを入力してください')
    expect(host.textContent).toContain('コードは半角英数字・_・ハイフンで1〜64文字にしてください')
  })

  it('保存の失敗文は入力を変えても残り、送り直すまで消えない', async () => {
    const onSave = vi.fn(async (): Promise<string> => { throw new Error('boom') })
    await render(onSave)

    await act(async () => {
      fireEvent.change(codeInput(), { target: { value: 'audit-sample' } })
    })
    await act(async () => { saveButton().click() })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('もう一度お試しください')

    // 別の有効な値へ変えても、送り直していないので失敗文は残す。
    await act(async () => {
      fireEvent.change(codeInput(), { target: { value: 'audit-sample-2' } })
    })
    expect(host.textContent).toContain('もう一度お試しください')
    expect(onSave).toHaveBeenCalledTimes(1)
  })
})
