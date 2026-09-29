import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIST_PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const EDIT_PAGE = readFileSync(join(HERE, 'edit', 'page.tsx'), 'utf8')
const NEW_PAGE = readFileSync(join(HERE, 'new', 'page.tsx'), 'utf8')
const MODAL = readFileSync(
  join(HERE, '..', '..', 'components', 'rich-menus', 'apply-to-tag-modal.tsx'),
  'utf8',
)

/** 点検 #502 の「中」: 書き込み系の取りこぼしをなくす (#552)。 */
describe('優先順の入替は1口でそろえる', () => {
  it('全件ぶんPATCHを並列に投げない', () => {
    expect(LIST_PAGE).toContain('api.richMenuGroups.reorderPriorities')
    // 途中失敗で順番が中途半端に残る投げ方に戻さない。
    expect(LIST_PAGE).not.toContain('Promise.all(')
  })

  it('隠れているメニューも含めて全部送る', () => {
    // 絞り込み中の画面だけを基準にすると、隠れているメニューとの優先関係が壊れる。
    expect(LIST_PAGE).toContain('moveTargetingGroup(groups, group.id')
    expect(LIST_PAGE).toContain('reordered.map((item) => item.id)')
  })
})

describe('公開失敗の文言は下書き保存の成否で分ける', () => {
  it('保存済みなのに「保存されていません」と出さない', () => {
    expect(EDIT_PAGE).toContain('draftSaved')
    expect(EDIT_PAGE).toContain('下書きは保存済みです')
    expect(EDIT_PAGE).toContain('下書きは保存されていません')
  })
})

describe('作成直後のフォルダ付けは作成口で決める', () => {
  it('作成後の付け直し2口目を投げない', () => {
    expect(NEW_PAGE).toContain('folderId')
    expect(NEW_PAGE).toContain('api.richMenuGroups.create({')
    // 失敗を握りつぶして未分類にしていた2口目に戻さない。
    expect(NEW_PAGE).not.toContain('api.richMenuGroups.update(res.data.id, { folderId })')
  })
})

describe('一括適用のやり直しは同じ鍵を使い回す', () => {
  it('鍵を送り、条件を変えたら振り直す', () => {
    expect(MODAL).toContain('idempotencyKey')
    expect(MODAL).toContain('api.richMenuGroups.applyToTag(groupId, params, idempotencyKey)')
    expect(MODAL).toContain('pickMode')
    // 鍵の振り直しは条件を変えたときだけ。やり直しで変えると台帳へ重複記録される。
    const rotations = MODAL.match(/setIdempotencyKey\(crypto\.randomUUID\(\)\)/g) ?? []
    expect(rotations.length).toBe(1)
    expect(MODAL).toContain('useState(() => crypto.randomUUID())')
  })
})
