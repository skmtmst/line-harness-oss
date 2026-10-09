/*
 * 試験用：作ってあるものを選ぶ欄（EntityPickerField・dJZ7Q）から窓を開き、名前の行を選んで確定する。
 * 画面の試験が、前のプルダウン（Select・Combobox）の代わりに使う。本番のコードからは読まない。
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect } from 'vitest'

function escape(text: string) { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

/** 1つ選ぶ欄。label は欄の読み上げ名、name は候補の名前。confirm は主ボタンの文字（既定は「選ぶ」）。 */
export async function pickEntity(label: string, name: string, confirm = '選ぶ') {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${escape(label)}：(選ぶ|変える)$`) }))
  const dialog = (await screen.findAllByRole('dialog')).at(-1)!
  fireEvent.click(await within(dialog).findByRole('radio', { name }))
  fireEvent.click(within(dialog).getByRole('button', { name: confirm }))
  await waitFor(() => expect(screen.queryAllByRole('dialog').includes(dialog)).toBe(false))
}

/** まとめて選ぶ欄。names の行にチェックを入れて確定する。 */
export async function pickEntities(label: string, names: string[]) {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${escape(label)}：(選ぶ|変える)$`) }))
  const dialog = (await screen.findAllByRole('dialog')).at(-1)!
  for (const name of names) fireEvent.click(await within(dialog).findByRole('checkbox', { name }))
  fireEvent.click(within(dialog).getByRole('button', { name: /^この .+にする$|^この.+にする$/ }))
  await waitFor(() => expect(screen.queryAllByRole('dialog').includes(dialog)).toBe(false))
}
