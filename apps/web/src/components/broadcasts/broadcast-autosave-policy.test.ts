import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
// 共通の自動保存（入力が2秒止まると保存・失敗の扱い）を使っていることは、
// broadcast-form-autosave.test.tsx が画面を動かして見る。ここは禁止の見張りだけ。
test('配信の下書きは画面独自の再送タイマーを持たない', () => {
  const text = readFileSync('src/components/broadcasts/broadcast-form.tsx', 'utf8')
  expect(text).not.toContain('autosaveRetryTimer')
})
