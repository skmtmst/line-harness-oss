import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 並べ替えのある一覧は、どれも同じ「付いてくる動き」を使う（触り心地 5 回目・オーナー採用）。
 * - 行に data-reorder-id（滑らかに場所を空ける目印）
 * - 行の上を通ったら置き場所を入れ替えて見せ、離したら見せていた位置へ置く
 * - つまみを離したら（表の外で離しても）動かしている状態を消す
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCREENS = [
  'v8/auto-replies/list.tsx',
  'v8/scenarios/list.tsx',
  'app/reminders/list-v8.tsx',
  'v8/tags/tags-tab.tsx',
  'v8/tags/fields-tab.tsx',
  'v8/tags/marks-tab.tsx',
  'v8/rich-menus/list.tsx',
  'v8/friend-add/list.tsx',
]

describe('並べ替えのある一覧は付いてくる動きを使う', () => {
  it.each(SCREENS)('%s', (file) => {
    const source = readFileSync(join(SRC, file), 'utf8')
    // 共通の並び替え（components/shared/reorder-handle の useReorder）に乗った画面は、
    // 付いてくる動きを部品の中で使う（下の「共通の並び替え」で部品側を確かめる）。
    if (source.includes("from '@/components/shared/reorder-handle'") && /useReorder\(/.test(source)) {
      expect(source).toMatch(/\.shown\.map\(/)
      expect(source).toMatch(/\.rowProps\(/)
      expect(source).toMatch(/\.handleProps\(/)
      expect(source).toMatch(/reorderKey=\{\w+\.shown|useFlipRows\(/)
      return
    }
    expect(source).toContain("from '@/lib/use-live-reorder'")
    expect(source).toMatch(/useLiveReorder\(/)
    expect(source).toMatch(/liveOrder\.shown\.map\(/)
    expect(source).toMatch(/data-reorder-id=\{/)
    expect(source).toMatch(/onDragEnter=\{\(\) => [^}]*liveOrder\.enter\(/)
    expect(source).toMatch(/liveOrder\.dropTarget\(/)
    expect(source).toContain('onDragEnd={() => setDragId(null)}')
    // 表の本体が滑らかに動く（RovingTbody の reorderKey か、useFlipRows のどちらか）
    expect(source).toMatch(/reorderKey=\{liveOrder\.shown|useFlipRows\(/)
  })
})

describe('共通の並び替え（useReorder）は付いてくる動きを使う', () => {
  it('components/shared/reorder-handle.tsx', () => {
    const source = readFileSync(join(SRC, 'components/shared/reorder-handle.tsx'), 'utf8')
    expect(source).toContain("from '@/lib/use-live-reorder'")
    expect(source).toMatch(/useLiveReorder\(/)
    expect(source).toMatch(/'data-reorder-id': id/)
    expect(source).toMatch(/onDragEnter: \(\) => live\.enter\(id\)/)
    expect(source).toMatch(/live\.dropTarget\(id\)/)
    expect(source).toMatch(/onDragEnd: \(\) => \{ setDragId\(null\)/)
  })
})
