import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

/*
 * ★V8 作成・編集画面の「欄から離れた時点で教える」配線の確認。
 *
 * 保存を押してから初めて赤くなる画面は「何が悪いか分からない」ので、
 * 文字を入れる欄は onBlur で1欄ぶん確かめ、直したらその場で消す。
 * 新しい V8 の入力画面を足すときも同じ形にし、WIRED へ1行足す。
 * （予約・イベント・ウェビナー・回答フォームは M6 の担当。ここでは触らない）
 */
const WIRED = [
  'app/webhooks/new/new-v8.tsx',
  'app/contents/vars/new/new-v8.tsx',
]

describe('V8 の blur 検証の配線（間違えない・怖くない）', () => {
  for (const file of WIRED) {
    it(`${file} は離れた欄だけその場で確かめる`, () => {
      const source = readFileSync(join(SRC, file.replace(/^app\//, 'app/')), 'utf8')
      // 文字を入れる欄に blur の確かめがある。
      expect(source).toContain('onBlur')
      // 欄ごとの赤い理由を持ち、読み上げにも出す。
      expect(source).toMatch(/fieldErrors|FieldError/)
      expect(source).toContain('role="alert"')
      // 文は「何をすれば直るか」を1文で（「してください」で終わる）。
      expect(source).toMatch(/してください/)
    })
  }
})
