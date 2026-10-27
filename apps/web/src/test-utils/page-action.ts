import { fireEvent, waitFor, within } from '@testing-library/react'
import { flushSync } from 'react-dom'

/** 利用者と同じく、見えている操作か、題の「…」を開いた先の操作を選ぶ。 */
export function queryPageAction(options: { name: string | RegExp; exact?: boolean }): HTMLElement | null {
  const page = within(document.body)
  const visible = page.queryByRole('button', options) ?? page.queryByRole('menuitem', options)
  if (visible) return visible
  for (const trigger of page.queryAllByRole('button').filter(node => node.matches('[data-page-heading-actions] button[aria-haspopup="menu"]'))) {
    const opened = trigger.getAttribute('aria-expanded') !== 'true'
    // Reactの非同期actの中から使う試験でも、操作を選ぶ前に開いた状態を確定する。
    if (opened) flushSync(() => fireEvent.click(trigger))
    const item = page.queryByRole('menuitem', options)
    if (item) return item
    if (opened && trigger.getAttribute('aria-expanded') === 'true') flushSync(() => fireEvent.click(trigger))
  }
  return null
}

export function getPageAction(options: { name: string | RegExp; exact?: boolean }): HTMLElement {
  return queryPageAction(options) ?? within(document.body).getByRole('button', options)
}

export function findPageAction(options: { name: string | RegExp; exact?: boolean }): Promise<HTMLElement> {
  return waitFor(() => getPageAction(options))
}

/** 手書きの操作探索を持つ試験も、移動した補助操作だけは実際のメニューで探す。 */
export function querySupplementaryPageAction(name: string): HTMLElement | undefined {
  return /下書|保存して続けて|複製して保存|まとめてテスト|まとめて下見|表示を変える|テストを送る|あとで決める|緊急停止/.test(name)
    ? queryPageAction({ name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }) ?? undefined : undefined
}
