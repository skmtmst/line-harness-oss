// @vitest-environment happy-dom
/* ：点数を手で直す窓。確定で落ちた欄は、その欄が赤くなり真下に理由が出て、1つ目の欄へ移る。 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), useSearchParams: () => new URLSearchParams('') }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'a', accounts: [], loading: false }) }))

import { ScoreAdjustDialog } from './score'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement
let root: Root
beforeEach(() => { document.documentElement.setAttribute('data-theme', 'v8'); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); document.documentElement.removeAttribute('data-theme') })

it('点数が空・理由が空なら確定せず、2つの欄が赤くなり、点数の欄へ移る', async () => {
  const onCompleted = vi.fn(async () => {})
  await act(async () => { root.render(<ScoreAdjustDialog accountId="a" friendId="f" friendName="山田" currentScore={50} highMin={70} normalMin={30} band="normal" onCancel={() => {}} onCompleted={onCompleted} />) })
  const amount = document.getElementById('ml-score-amount') as HTMLInputElement
  fireEvent.change(amount, { target: { value: '' } })
  const confirm = Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => /点|変更|直す/.test(b.textContent ?? '') && b.textContent?.trim() !== 'キャンセル') as HTMLButtonElement
  await act(async () => { confirm.click() })
  await act(async () => { await new Promise((r) => requestAnimationFrame(r)) })
  expect(onCompleted).not.toHaveBeenCalled()
  expect(amount.getAttribute('aria-invalid')).toBe('true')
  expect(document.getElementById('ml-score-amount-error')?.textContent).toBe('1以上1000000以下の整数で点数を入力してください')
  expect(document.getElementById('ml-score-reason-error')?.textContent).toBe('理由を入力してください。')
  expect(document.activeElement).toBe(amount)
})
it('点数を直す窓に操作するアカウントと環境を表示する', async () => {
 await act(async () => { root.render(<ScoreAdjustDialog accountId="a" friendId="f" friendName="山田" currentScore={50} highMin={70} normalMin={30} band="normal" onCancel={() => {}} onCompleted={async () => {}} />) })
 const dialog = document.querySelector('[role="dialog"]')!
 expect(dialog.textContent).toContain('LINEアカウント')
 expect(dialog.textContent).toContain('環境')
})
it('窓を開いた後のアカウント切替では古い点数変更を送らない', async () => {
 const { api } = await import('@/lib/api')
 const adjust = vi.spyOn(api.actionScores, 'adjust').mockResolvedValue({ success: true } as never)
 const draw = (accountId: string) => <ScoreAdjustDialog accountId={accountId} friendId="f" friendName="山田" currentScore={50} highMin={70} normalMin={30} band="normal" onCancel={() => {}} onCompleted={async () => {}} />
 await act(async () => { root.render(draw('a')) })
 fireEvent.change(document.getElementById('ml-score-reason')!, { target: { value: '人工の理由' } })
 const button = Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => b.textContent?.includes('点減らす'))!
 const key = Object.keys(button).find(item => item.startsWith('__reactProps$'))!
 const oldConfirm = (button as unknown as Record<string,{onClick:(e:unknown)=>unknown}>)[key].onClick
 await act(async () => { root.render(draw('b')) })
 await act(async () => { root.render(draw('a')) })
 await act(async () => { await oldConfirm({ defaultPrevented:false, preventDefault(){}, stopPropagation(){}, currentTarget:button, target:button }) })
 expect(adjust).not.toHaveBeenCalled()
 adjust.mockRestore()
})
