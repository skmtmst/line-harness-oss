import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const LIST_V8 = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'list-v8.tsx'), 'utf8')

/** リッチメニューの削除できない理由の窓（板 `yOyCg`）の言葉を絵に合わせる歯止め。 */
describe('yOyCg 消せない理由の窓', () => {
  it('理由があるときは見出しを「まだ消せません」にし取消を「閉じる」にする', () => {
    expect(LIST_V8).toContain('はまだ消せません')
    expect(LIST_V8).toContain("cancelLabel={blockedDelete ? '閉じる' : 'キャンセル'}")
  })

  it('消せない理由を外す順の番号つきで並べる', () => {
    expect(LIST_V8).toContain('blockerTexts(impact.blockers)')
    expect(LIST_V8).toContain('<ol')
  })
})
