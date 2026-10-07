import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/* 一覧の入口は V8 のとき src/v8/rich-menus/list.tsx（2026-10-06〜。古い list-v8.tsx はもう描かれない）。窓は blocked-dialog.tsx。 */
const V8_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'v8', 'rich-menus')
const LIST_V8 = readFileSync(join(V8_DIR, 'list.tsx'), 'utf8')
const BLOCKED = readFileSync(join(V8_DIR, 'blocked-dialog.tsx'), 'utf8')

/** リッチメニューの削除できない理由の窓（板 `yOyCg`）の言葉を絵に合わせる歯止め。 */
describe('yOyCg 消せない理由の窓', () => {
  it('理由があるときは見出しを「まだ消せません」にし取消を「閉じる」にする', () => {
    expect(LIST_V8).toContain('はまだ消せません')
    // 新しい一覧は理由があるとき専用の窓（BlockedDeleteDialog）を出し、取消は「閉じる」だけ。
    const blocked = LIST_V8.slice(LIST_V8.indexOf('const blockedDialog'), LIST_V8.indexOf('const deleteConfirm'))
    expect(blocked).toContain('<BlockedDeleteDialog')
    expect(blocked).toContain('onClick={closeDelete} disabled={deleteBusy}>閉じる</Button>')
    expect(blocked).not.toContain('キャンセル')
  })

  it('消せない理由を外す順の番号つきで並べる', () => {
    expect(LIST_V8).toContain('blockerTexts(')
    expect(BLOCKED).toContain('<ol')
  })
})
