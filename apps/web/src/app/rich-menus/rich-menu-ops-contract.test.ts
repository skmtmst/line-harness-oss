import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { readApiSource } from '../../../scripts/test-api-source.mjs'
import { readFileSync } from 'node:fs'
import { dirname,join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { api } from '@/lib/api'
import ts from 'typescript'
import { areaDraftsWithSwitchTargets, mediaToFile } from '../../v8/rich-menus/new/create-draft'
import { describe,expect,it,vi } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIST_PAGE = readFileSync(join(HERE, '../../v8/rich-menus/list.tsx'), 'utf8')
const EDIT_PAGE = readUiSource(new URL('../../v8/rich-menus/new/create.tsx', import.meta.url), 'utf8')
const PUBLISH_HISTORY = readFileSync(join(HERE, '../../v8/rich-menu-edit/detail.tsx'), 'utf8')
const TEST_APPLY = readFileSync(join(HERE, '../../v8/rich-menu-edit/test-apply.tsx'), 'utf8')
const NEW_PAGE = readUiSource(new URL('../../v8/rich-menus/new/create.tsx', import.meta.url), 'utf8')
const CREATE_FORM = readFileSync(
  join(HERE, '../../v8/rich-menu-edit/compatibility-form.tsx'),
  'utf8',
)
const API = readApiSource(join(HERE, '..', '..', 'lib', 'api.ts'), 'utf8')

/** #898 / N-163: ボタン名でも見つかる検索 */
describe('一覧の検索はボタン名にも当たる', () => {
  it('案内文が「メニュー名・ボタン名」になっている', () => {
    expect(LIST_PAGE).toContain('メニュー名・ボタン名で探す')
  })
})

/** #899 / N-164: 登録メディアの選択が作成フォームへ戻る */
describe('作成画面の登録メディア選択', () => {
  it('メディア選択ダイアログを今のアカウントで開き、選択がフォームへ戻る', () => {
    const parsedModule = ts.createSourceFile('create.tsx', NEW_PAGE, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const picker = parsedModule.statements.filter(ts.isImportDeclaration).filter(statement => {
      const bindings = statement.importClause?.namedBindings
      return bindings && ts.isNamedImports(bindings) && bindings.elements.some(binding => binding.name.text === 'MediaPickerDialog')
    })
    expect(picker).toHaveLength(1)
    expect((picker[0].moduleSpecifier as ts.StringLiteral).text).toBe('@/v8/contents/public/media-picker-dialog/index')
    expect(NEW_PAGE).toContain('accountId={accountId}')
    expect(NEW_PAGE).toContain('onSelect={handlePickedMedia}')
    expect(NEW_PAGE).toContain('setPendingImageAt(imagePickTarget, { file: null, url: null, dims: null, media: item })')
    // キャンセルは入力を捨てない（onClose は閉じるだけ）
    expect(NEW_PAGE).toContain('onClose={() => setMediaPickerOpen(false)}')
    // 選んだ画像のプレビューがフォーム内に残る
    // 登録画像の取得時のアカウントは下の実行試験で確かめる。
    // 作成APIへ imageMediaId を渡す
    expect(NEW_PAGE).toContain('imageMediaId: pendingImages[0]?.media?.id')
  })

  it('登録画像を現在のアカウントで取得し、失敗した応答を画像にしない', async () => {
    const contentUrl = vi.spyOn(api.media, 'contentUrl').mockReturnValue('/registered-image')
    const fetchImage = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('image-data', { headers: { 'Content-Type': 'image/png' } }))
    const media = { id: 'media-a', filename: '案内.png', mimeType: 'image/png' } as Parameters<typeof mediaToFile>[0]
    try {
      const file = await mediaToFile(media, 'account-a')
      expect(contentUrl).toHaveBeenCalledWith('media-a', 'account-a')
      expect(fetchImage).toHaveBeenCalledWith('/registered-image', { credentials: 'include' })
      expect(file.name).toBe('案内.png')
      expect(await file.text()).toBe('image-data')
      fetchImage.mockResolvedValueOnce(new Response('denied', { status: 403 }))
      await expect(mediaToFile(media, 'account-a')).rejects.toThrow('403')
    } finally {
      contentUrl.mockRestore()
      fetchImage.mockRestore()
    }
  })

  it('選んだメディアも未保存の入力として数える', () => {
    expect(NEW_PAGE).toContain('images: pendingImages.map((image) =>')
    expect(NEW_PAGE).toContain('image.media?.id')
  })
})

/** #900 / N-151: 履歴・失敗だけの再試行・照合 */
describe('公開履歴・再試行・照合', () => {
  it('編集画面に履歴セクションがあり owner/admin のみ出す', () => {
    expect(PUBLISH_HISTORY).toContain("const canInspectOperations = role === 'owner' || role === 'admin'")
    expect(PUBLISH_HISTORY).toContain('aria-label="公開の履歴とLINEとの照合"')
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
  it('行の複製は二重実行を防ぎ、再取得した一覧に結果を示す', () => {
    expect(LIST_PAGE).toContain('duplicateLock.current = true')
    expect(LIST_PAGE).toContain('api.richMenuGroups.duplicate')
    expect(LIST_PAGE).toContain('confirmDuplicate')
    // 確認なしの即実行ではない
    expect(LIST_PAGE).toContain('複製')
    expect(LIST_PAGE).toContain('duplicateFeedback.mark(duplicateTarget.id, res.data.id)')
  })

  it('編集画面にも複製がある', () => {
    expect(PUBLISH_HISTORY).toContain('open={duplicateOpen}')
    expect(PUBLISH_HISTORY).toContain('api.richMenuGroups.duplicate')
  })
})

/** #903 / N-156: staffへは合計だけ */
describe('staffへの影響人数は合計のみ', () => {
  it('編集画面は staff を読み取り専用にし、集計だけを読む', () => {
    expect(EDIT_PAGE).toContain('audienceSummary')
    expect(EDIT_PAGE).toContain('aggregateOnly')
    expect(EDIT_PAGE).toContain('disabled={aggregateOnly}')
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
    expect(NEW_PAGE).toContain('defaultPageIndex: 0')
    expect(NEW_PAGE).toContain('isDefaultForAll:')
    expect(NEW_PAGE).toContain("targetingEnabled: audience === 'targeted'")
    expect(NEW_PAGE).toContain('targetingPriority,')
    const area = { id: 'switch', actionType: 'richmenuswitch', actionData: { targetPageId: '2' } } as Parameters<typeof areaDraftsWithSwitchTargets>[0][number]
    expect(areaDraftsWithSwitchTargets([area])[0].actionData).toEqual({ targetPageIndex: 2 })
    // 切替ボタンを新規作成で選べる
    expect(NEW_PAGE).toContain('NEW_MENU_INTENTS_WITH_SWITCH')
    // 行き先未設定の切替を黙って送らない
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
