import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
test('配信の下書きも共通の自動保存を使い、画面独自の再送タイマーを持たない', () => {
  const text = readFileSync('src/components/broadcasts/broadcast-form.tsx', 'utf8')
  expect(text).toContain('useDraftAutosave(')
  expect(text).not.toContain('autosaveRetryTimer')
})
