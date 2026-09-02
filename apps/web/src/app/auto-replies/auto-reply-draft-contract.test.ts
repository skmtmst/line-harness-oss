import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { toDraft } from '@/components/auto-replies/edit-dialog'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (...parts: string[]) => readFileSync(join(HERE, ...parts), 'utf8')
const LIST = read('page.tsx')
const EDIT = read('edit', 'page.tsx')
const DIALOG = read('..', '..', 'components', 'auto-replies', 'edit-dialog.tsx')

/**
 * 編集を開いたときの中身を、1か所で作ること。
 *
 * 一覧の「編集」と `/auto-replies/edit?id=` が、それぞれ項目を並べ直して
 * いました。URL から開いたほうは曜日・アクション・キーワードの複数行・
 * 友だち条件を落としており、**開いて保存した時点でその設定が消えます。**
 *
 * 編集の窓は1つに寄せてあったのに（`edit/page.tsx` の覚え書き）、
 * **窓へ渡す中身は2つ持ったまま**で、そこが食い違っていました。
 */
describe('自動応答の編集に渡す中身', () => {
  it('2か所とも同じ作り手を通す', () => {
    expect(LIST).toContain('setEditing(toDraft(r))')
    expect(EDIT).toContain('setDraft(toDraft(res.data))')
    expect(DIALOG).toContain('export function toDraft(')
  })

  it('呼ぶ側が項目を並べ直さない（また食い違うため）', () => {
    expect(LIST).not.toContain('keywordMatchMode: r.keywordMatchMode')
    expect(EDIT).not.toContain('keywordMatchMode: res.data.keywordMatchMode')
  })

  it('曜日・アクション・キーワードの複数行も落とさない', () => {
    expect(DIALOG).toContain('responseWeekdays: rule.responseWeekdays ?? null')
    expect(DIALOG).toContain('actions: rule.actions ?? null')
    expect(DIALOG).toContain('keywords: rule.keywords ?? null')
    expect(DIALOG).toContain('friendConditions: rule.friendConditions ?? null')
    expect(DIALOG).toContain('folderId: rule.folderId ?? null')
  })

  it('フォルダ内のルールを開いても未分類へ移さない', () => {
    expect(toDraft({
      id: 'reply-1',
      keyword: '予約',
      matchType: 'contains',
      responseType: 'text',
      responseContent: '承りました',
      templateId: null,
      lineAccountId: 'account-1',
      isActive: true,
      priority: 10,
      folderId: 'folder-1',
    }).folderId).toBe('folder-1')
  })

  it('段の番号が、上から 1・2・3 の順に出る', () => {
    const one = DIALOG.indexOf('1. どのメッセージに反応するか')
    const two = DIALOG.indexOf('2. いつ・誰に反応するか')
    const three = DIALOG.indexOf('3. 何を返すか')
    expect(one).toBeGreaterThan(-1)
    expect(two).toBeGreaterThan(one)
    expect(three).toBeGreaterThan(two)
  })
})
