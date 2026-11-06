import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
test('回答フォームの保存完了を帯とトーストで二重に知らせない', () => {
  const source = readFileSync('src/v8/form-edit/edit.tsx', 'utf8')
  expect(source).not.toContain("setNotice(publishedVersionId ? '下書きを保存しました")
  expect(source).toContain("notifySaved('下書きを保存しました')")
})
