import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
it.each(['templates/list', 'scenarios/list', 'tags/tags-tab', 'broadcasts/list', 'auto-replies/list', 'forms/list'])('決まり2：%sの削除を確認前に予約実行しない', (file) => {
  const source = readFileSync(`src/v8/${file}.tsx`, 'utf8')
  expect(source).not.toContain('useDeferredDelete')
  expect(source).not.toContain('deferredDelete.schedule')
})
