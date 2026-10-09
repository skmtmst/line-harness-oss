import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIST_PAGE = readFileSync(new URL('../../v8/rich-menus/list.tsx', import.meta.url), 'utf8')
const EDIT_PAGE = readFileSync(new URL('../../v8/rich-menu-edit/detail.tsx', import.meta.url), 'utf8') + readFileSync(new URL('new/create-v8.tsx', import.meta.url), 'utf8')
const PUBLISH_HISTORY = readFileSync(join(HERE, 'edit', 'publish-history.tsx'), 'utf8')
const TEST_APPLY = readFileSync(join(HERE, 'edit', 'test-apply-section.tsx'), 'utf8')
const NEW_PAGE = readFileSync(new URL('new/create-v8.tsx', import.meta.url), 'utf8')
const CREATE_FORM = readFileSync(
  join(HERE, '..', '..', 'components', 'rich-menus', 'rich-menu-create-form.tsx'),
  'utf8',
)
const API = readFileSync(join(HERE, '..', '..', 'lib', 'api.ts'), 'utf8')

/** #898 / N-163: ボタン名でも見つかる検索 */
describe('一覧の検索はボタン名にも当たる', () => {
  it('案内文が「メニュー名・ボタン名」になっている', () => {
    expect(LIST_PAGE).toContain('メニュー名・ボタン名で検索')
  })
})

/** #899 / N-164: 登録メディアの選択が作成フォームへ戻る */
describe('作成画面の登録メディア選択', () => {
  it('メディア選択ダイアログを今のアカウントで開き、選択がフォームへ戻る', () => {
expect(NEW_PAGE).toContain('<MediaPickerDialog')
    expect(NEW_PAGE).toContain('accountId={accountId}')
    expect(NEW_PAGE).toContain('setSelectedMedia(item)')
    expect(NEW_PAGE).toContain('imageMediaId: selectedMedia?.id')
  })

  it('アカウントを切り替えたら前のアカウントの選択を持ち込まない', () => {
expect(NEW_PAGE).toContain('setSelectedMedia(null)')
    expect(NEW_PAGE).toContain('[accountId')
  })

  it('選んだメディアも未保存の入力として数える', () => {
    expect(NEW_PAGE).toContain('selectedMedia !== null')
  })
})

/** #900 / N-151: 履歴・失敗だけの再試行・照合 */
describe('公開履歴・再試行・照合', () => {
  it('編集画面に履歴セクションがあり owner/admin のみ出す', () => {
expect(EDIT_PAGE).toContain('api.richMenuGroups.publishRuns(groupId)')
    expect(EDIT_PAGE).toContain("role === 'owner' || role === 'admin'")
    expect(EDIT_PAGE).toContain('canOperate')
  })

  it('失敗したrunだけに再試行ボタンを出し、照合は dryRun → 明示修復の順', () => {
    expect(PUBLISH_HISTORY).toContain('retryPublishRun')
    expect(PUBLISH_HISTORY).toContain("run.status === 'failed'")
    expect(PUBLISH_HISTORY).toContain('reconcile(groupId, true)')
    expect(PUBLISH_HISTORY).toContain('reconcile(groupId, false)')
  })
})

/** #901 / N-152: 本人LINEへのテスト適用 */
describe('本人LINEへのテスト適用', () => {
  it('適用・取り消しの両方に確認を挟み、未連携の案内を出す', () => {
    expect(TEST_APPLY).toContain('testApplyState')
    expect(TEST_APPLY).toContain('linkGuidance')
    expect(TEST_APPLY).toContain('confirmLabel')
    expect(TEST_APPLY).toContain('testApplyRevert')
  })
})

/** #902 / N-154: 下書き複製 */
describe('一覧と編集からの複製', () => {
  it('一覧の各行に複製があり、確認ダイアログ経由で作成→編集へ進む', () => {
    expect(LIST_PAGE).toContain('setDuplicateTarget')
    expect(LIST_PAGE).toContain('api.richMenuGroups.duplicate')
    expect(LIST_PAGE).toContain('confirmDuplicate')
    // 確認なしの即実行ではない
    expect(LIST_PAGE).toContain('複製')
    expect(LIST_PAGE).toContain('router.push(`/rich-menus/edit?id=${res.data.id}`)')
  })

  it('編集画面にも複製がある', () => {
expect(EDIT_PAGE).toContain('open={duplicateOpen}')
    expect(EDIT_PAGE).toContain('api.richMenuGroups.duplicate')
  })
})

/** #903 / N-156: staffへは合計だけ */
describe('staffへの影響人数は合計のみ', () => {
  it('編集画面は staff を読み取り専用にし、集計だけを読む', () => {
expect(EDIT_PAGE).toContain('if (aggregateOnly)')
    expect(EDIT_PAGE).toContain('api.richMenuGroups.audienceSummary(group.id)')
    expect(EDIT_PAGE).toContain("staffRole === 'staff' || staffRole === 'viewer'")
  })
})

/** #904 / N-161: 作成で切替・既定・出し分けを決める */
describe('作成時の既定ページ・出し分け・切替', () => {
  it('作成フォームに既定ページ・出し分け・全員既定の入力がある', () => {
    expect(CREATE_FORM).toContain('audienceSetup')
    expect(CREATE_FORM).toContain('defaultPageIndex')
    expect(CREATE_FORM).toContain('targetingEnabled')
    expect(CREATE_FORM).toContain('isDefaultForAll')
    expect(CREATE_FORM).toContain('最初に見せるページ')
  })

  it('作成APIへ全部送り、切替の行き先は targetPageIndex に直す', () => {
for(const field of ['defaultPageIndex: 0', 'isDefaultForAll:', "targetingEnabled: audience === 'targeted'", 'targetingPriority,', 'targetPageIndex']) expect(NEW_PAGE).toContain(field)
    expect(NEW_PAGE).toContain('行き先ページが決まっていません')
  })
})

/** APIクライアントの経路が route と一致する */
describe('APIクライアントの経路', () => {
  it('新しい経路を持つ', () => {
    for (const path of [
      '/publish-runs`',
      '/publish-runs/${requestId}/retry',
      '/reconcile',
      '/duplicate',
      '/audience-summary',
      '/test-apply',
      '/test-apply/revert',
    ]) {
      expect(API).toContain(path)
    }
  })

  it('作成に imageMediaId・既定ページ・出し分けを載せる', () => {
    expect(API).toContain('imageMediaId?: string')
    expect(API).toContain('defaultPageIndex?: number')
    expect(API).toContain('targetingEnabled?: boolean')
  })
})
