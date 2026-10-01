import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

/*
 * ★V7 sTJsh §6「欄から離れた時点で教える」の配線を機械的に確認する。
 *
 * 共有の `useFormErrors` で欄を登録し、`CreatePage` の `fields` へ渡すと
 * 「離れた欄だけ出す・送信でまとめ＋1つ目へ移る」がそろう。新しい入力画面を
 * 足すときも同じ形にし、欄ごとの手書き検査を増やさない。
 */
const WIRED = [
  'app/webhooks/new/page.tsx',
  'app/staff/new/page.tsx',
]

describe('blur検証の配線（★V7 sTJsh §6）', () => {
  for (const file of WIRED) {
    it(`${file} は useFormErrors を CreatePage へ渡している`, () => {
      const source = readFileSync(join(SRC, file.replace(/^app\//, 'app/')), 'utf8')
      expect(source).toContain('useFormErrors')
      // CreatePage（または同じまとめ帯）へ fields を渡して、送信時の
      // 「まとめ＋1つ目へ移る」を共有側に任せている。
      expect(source).toMatch(/fields=\{fields\}/)
      // 少なくとも1欄を登録して blur で検査している。
      expect(source).toContain('fields.define(')
    })
  }
})
