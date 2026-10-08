/*
 * ★V8 物を作る・直す画面の「どのフォルダに入れるか」は FolderSelect（dLffh・その場で作れる）。
 * 画面ごとに作り方を書かず、各画面は自分の種類のフォルダの口を onCreate に渡すだけ（オーナー 2026-10-08）。
 * 閲覧のみ・権限なしでは onCreate を渡さない（「＋ 新しいフォルダを作る」を出さない）ことを、
 * 各画面が onCreate を権限の値で切り替えているかで見張る。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (path: string) => readFileSync(join(SRC, path), 'utf8')

/** 画面 → onCreate を決める権限の値（その値が偽なら作らせない）。 */
const SCREENS: Array<[string, RegExp]> = [
  ['v8/tags/create.tsx', /onCreate=\{canEditFolders && selectedAccountId \?/],
  ['v8/tag-edit/edit.tsx', /onCreateGroup=\{canEdit && selectedAccountId \?/],
  ['v8/template-edit/message.tsx', /: canMutate && editorAccountId\s*\?/],
  ['v8/template-edit/rich.tsx', /: canMutate && selectedAccountId\s*\?/],
  ['v8/template-edit/asset.tsx', /: canMutate && selectedAccountId\s*\?/],
  ['v8/templates/question-new.tsx', /: canMutate && folderAccountId\s*\?/],
  ['v8/templates/carousel.tsx', /: canMutate && folderAccountId\s*\?/],
  ['v8/hq-templates/console.tsx', /createFolder: canEdit \? createFolder : undefined/],
  ['v8/hq-templates/message-form.tsx', /onCreate=\{onCreateFolder\}/],
  ['v8/hq/account-dialogs.tsx', /onCreate=\{canCreateFolder\s*\?/],
  ['v8/hq-broadcasts/create.tsx', /onCreate=\{canManage \? createHqFolder : undefined\}/],
  ['v8/webinar-edit/basic-form.tsx', /onCreate=\{onCreateFolder\}/],
  ['v8/webinar-edit/basic.tsx', /onCreateFolder=\{!readOnly && webinar\.accountId/],
  ['v8/friend-add/editor.tsx', /onCreateFolder=\{canEdit && selectedAccountId/],
  ['v8/tags/field-editor.tsx', /onCreate=\{locked \? undefined : onCreateFolder\}/],
  ['v8/tags/field-new.tsx', /onCreateFolder=\{canCreateFolder\s*\?/],
  ['v8/tags/field-edit.tsx', /onCreateFolder=\{canCreateFolder\s*\?/],
  ['v8/scenarios/create.tsx', /onCreate=\{canEdit && !locked\s*\?/],
  ['v8/scenario-detail/detail.tsx', /onCreate=\{canEdit\s*\?/],
  ['v8/common-vars-edit/edit.tsx', /onCreate=\{canWrite && selectedAccountId\s*\?/],
  ['v8/common-vars-edit/new.tsx', /onCreate=\{canWrite && selectedAccountId\s*\?/],
  ['v8/reminders/basics-form.tsx', /onCreate=\{canCreateFolder\s*\?/],
  ['app/reminders/basics-form-v8.tsx', /onCreate=\{canCreateFolder\s*\?/],
  ['v8/contents/list.tsx', /onCreateFolder=\{canManageMedia\s*\?/],
  ['app/rich-menus/new/create-v8.tsx', /onCreate=\{!canOperate\s*\?\s*undefined/],
  ['app/auto-replies/edit/wizard-v8.tsx', /onCreate=\{canManage\s*\?/],
  ['components/broadcasts/broadcast-form.tsx', /onCreate=\{canCreateFolder \? createFolder : undefined\}/],
]

describe('物のフォルダを選ぶ欄は FolderSelect（dLffh）', () => {
  it.each(SCREENS)('%s は権限があるときだけ作る口を渡す', (path, gate) => {
    expect(read(path)).toMatch(gate)
  })

  it.each(SCREENS.filter(([path]) => !/(contents\/list|basic\.tsx|field-new|field-edit|hq-templates\/console)/.test(path)))('%s は FolderSelect を使う（フォルダを選ぶ素の Select を残さない）', (path) => {
    const source = read(path)
    expect(source).toContain('<FolderSelect')
    expect(source).not.toMatch(/<Select[^>]*aria-label="(?:フォルダ|所属フォルダ|入れるフォルダ|置き場（フォルダ）|シナリオのフォルダ|友だち情報欄のフォルダ)"/s)
  })

  it('作る受け口は画面に書かず、共通部品の板（iBuZH）が持つ', () => {
    for (const [path] of SCREENS) {
      expect(read(path)).not.toContain('作って選ぶ')
    }
    expect(read('components/shared/folder-select.tsx')).toContain('作って選ぶ')
  })
})
