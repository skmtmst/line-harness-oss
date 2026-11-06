import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 消せない理由の窓（板 yOyCg）の見出し・「閉じる」・外す順の番号つきの並びは、
 * src/v8/rich-menus/list.test.tsx と list-ops-react.test.tsx が窓を開いて見る。
 * ここには取消を「キャンセル」に戻さない禁止の見張りだけを残す。
 */
const V8_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'v8', 'rich-menus')
const LIST_V8 = readFileSync(join(V8_DIR, 'list.tsx'), 'utf8')

describe('yOyCg 消せない理由の窓', () => {
  it('理由があるときの取消を「キャンセル」にしない', () => {
    const blocked = LIST_V8.slice(LIST_V8.indexOf('const blockedDialog'), LIST_V8.indexOf('const deleteConfirm'))
    expect(blocked).not.toContain('キャンセル')
  })
})
