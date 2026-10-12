import { act, fireEvent } from '@testing-library/react'

/** 現役の時刻欄を入力とEnterで操作する。値の変換は部品自身に任せる。 */
export async function setTimeControl(element: Element | null, value: string): Promise<void> {
  if (!(element instanceof HTMLInputElement) || element.getAttribute('role') !== 'combobox') {
    throw new Error('現役の時刻欄が見つかりません')
  }
  await act(async () => {
    fireEvent.focus(element)
    fireEvent.change(element, { target: { value } })
    fireEvent.keyDown(element, { key: 'Enter' })
  })
}
