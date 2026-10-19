import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

/*
 * ★管理画面 sTJsh §6「欄から離れた時点で教える」の配線を機械的に確認する。
 *
 * 共有の `useFormErrors` で欄を登録し、`CreatePage` の `fields` へ渡すと
 * 「離れた欄だけ出す・送信でまとめ＋1つ目へ移る」がそろう。新しい入力画面を
 * 足すときも同じ形にし、欄ごとの手書き検査を増やさない。
 */
const WIRED = [
  'v8/settings/staff/create.tsx',
]

describe("blur検証の配線", () => {
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

// 現役V8は欄を離れた時の検査と、送信時のまとめ/最初の誤りへの移動を持つ。
it('Webhook作成のV8は欄を離れた時と送信時の検査を保つ', () => {
  const source = readFileSync(join(SRC, 'v8/webhooks/create.tsx'), 'utf8')
  for (const key of ['name', 'url', 'secret']) expect(source).toContain(`onBlur={() => blurField('${key}')}`)
  expect(source).toContain('setFieldErrors(errors)')
  expect(source).toContain('Object.keys(errors)[0]')
  expect(source).toContain('.focus()')
  expect(source).toContain('Object.keys(errors).length > 0')
})
