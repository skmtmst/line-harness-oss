import { act } from 'react'

/** 現役の窓と行の操作を使う。閉じる途中の窓は操作しない。 */
export function automationButton(text: string, scope: ParentNode = document): HTMLButtonElement {
  const button = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text && !node.closest('[data-closing]'))
  if (!button) throw new Error(`ボタンが見つかりません: ${text}`)
  return button
}

export async function clickAutomationButton(text: string, scope: ParentNode = document): Promise<void> {
  await act(async () => { automationButton(text, scope).click() })
}

export async function openFirstAutomationAction(): Promise<void> {
  const menu = document.querySelector<HTMLButtonElement>('[aria-label="1つ目の行うことのその他操作"]')
  if (!menu) throw new Error('先頭の処理の操作がありません')
  await act(async () => { menu.click() })
  await clickAutomationButton('設定を変える')
}

export async function pickAutomationTag(name: string): Promise<void> {
  if (!document.querySelector('button[id^="v8-tag-"]')) await openFirstAutomationAction()
  await act(async () => { document.querySelector<HTMLButtonElement>('button[id^="v8-tag-"]')!.click() })
  const checkbox = [...document.querySelectorAll<HTMLElement>('[role="checkbox"], input[type="checkbox"]')].find(node => node.getAttribute('aria-label') === name && !node.closest('[data-closing]'))
  if (!checkbox) throw new Error(`タグが見つかりません: ${name}`)
  await act(async () => { checkbox.click() })
  await clickAutomationButton('選ぶ（1件）')
}

export async function replaceFirstAutomationAction(label: string): Promise<void> {
  const menu = document.querySelector<HTMLButtonElement>('[aria-label="1つ目の行うことのその他操作"]')
  if (!menu) throw new Error('先頭の処理の操作がありません')
  await act(async () => { menu.click() })
  await clickAutomationButton('削除する')
  await clickAutomationButton('削除する')
  await clickAutomationButton('行うことを足す')
  await clickAutomationButton(label)
}
