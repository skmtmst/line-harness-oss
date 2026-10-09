import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { normalizeDeleteTitle } from './confirm-dialog'
it.each(['templates/list', 'scenarios/list', 'tags/tags-tab', 'broadcasts/list', 'auto-replies/list', 'forms/list'])('決まり2：%sの削除を確認前に予約実行しない', (file) => {
  const source = readFileSync(`src/v8/${file}.tsx`, 'utf8')
  expect(source).not.toContain('useDeferredDelete')
  expect(source).not.toContain('deferredDelete.schedule')
})


it('単件と一括の削除の題を、対象名と同じ問い方にそろえる', () => {
  expect(normalizeDeleteTitle('フォルダ「週末」を削除する')).toBe('「週末」を削除しますか？')
  expect(normalizeDeleteTitle('3件をまとめて削除しますか？')).toBe('「選択した3件」を削除しますか？')
  expect(normalizeDeleteTitle('予約を取り消しますか？')).toBe('予約を取り消しますか？')
})
