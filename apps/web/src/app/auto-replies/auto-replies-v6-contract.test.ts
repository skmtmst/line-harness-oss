import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const EDITOR = fs.readFileSync(
  path.join(__dirname, '../../components/auto-replies/edit-dialog.tsx'),
  'utf8',
)
const PUBLISH = fs.readFileSync(new URL('edit/wizard-v8.tsx', import.meta.url), 'utf8')
const LIST = fs.readFileSync(new URL('../../v8/auto-replies/list.tsx', import.meta.url), 'utf8')
const EDIT_PAGE = fs.readFileSync(new URL('edit/wizard-v8.tsx', import.meta.url), 'utf8')

describe('V6 自動応答一覧の契約', () => {
  it('共通の編集用変換と保存本文で所属フォルダを引き継ぐ', () => {
    expect(EDITOR).toContain('folderId: rule.folderId ?? null')
    expect(EDITOR).toContain("useState(draft.folderId ?? '')")
    expect(EDITOR).toContain('folderId: folderId || null')
  })

  it('窓の中では順番の数字を打たせず位置と先に当たるルールだけ出す（R28）', () => {
    // R28（2026-09-27 監査）：「高いほど先に判定」と「小さいほど先」が
    // 同じ窓に混在し、実際の判定（小さいほど先）と食い違っていた。
    // 順番は一覧の上下入れ替えで決め、窓の中では数字の入力・選択を置かない。
    expect(EDITOR).not.toContain('PRIORITY_CANDIDATES')
    expect(EDITOR).not.toContain('id="ar-priority"')
    expect(EDITOR).toContain('orderHint')
  })

  it('順番は一覧の「評価順」で上下を入れ替えて決める（R28）', () => {
    // 新しい口は足さず、既存の更新口で隣と数字を交換する。
    expect(LIST).toContain('movePriorityUpdates')
    expect(LIST).toContain("sortKey !== 'priority'")
  })

  it('一致方法の選択は送る行にも載る（R29）', () => {
    // R29（2026-09-27 監査）：部分一致を選んでも行だけ完全一致のまま
    // 保存され、判定側（行を優先）が拾わなかった。選び直したら全行へ載せ、
    // 足した行はいまの選択を引き継ぎ、空行は落として送る。
    expect(EDITOR).toContain('applyMatchType')
    expect(EDITOR).toContain('initialMatchType')
    expect(EDITOR).toContain('emptyKeywordRule(matchType)')
    expect(EDITOR).toContain('effectiveRules')
  })

  it('フォルダの未取得を0件に見せず、同じ編集画面で再取得できる', () => {
    expect(EDITOR).toContain('res.success && Array.isArray(res.data)')
    expect(EDITOR).toContain("foldersLoadState === 'error'")
    expect(EDITOR).toContain("disabled={foldersLoadState !== 'ready'}")
    expect(EDITOR).toContain('setFoldersReloadToken((value) => value + 1)')
  })

  it('公開前テストは実在する友だちを選び、本番と同じdry-run APIへ渡す', () => {
    expect(PUBLISH).toContain('api.friends.list({')
    expect(PUBLISH).toContain('friendId: selectedFriendId')
    expect(PUBLISH).toContain('api.autoReplies.testDraft(ruleId')
    expect(PUBLISH).toContain("setDryRun(res.data)")
  })

  it('取得できなかった過去28日の数を0件に見せない', () => {
    expect(PUBLISH).toContain("matchedLast28Days == null ? '—'")
    expect(PUBLISH).toContain('`${formatNumber(matchedLast28Days)}件`')
  })

  it('URL編集は基本設定・反応条件・返信を別々の段として開ける', () => {
    expect(EDIT_PAGE).toContain("raw === 'trigger' || raw === 'response'")
    expect(EDIT_PAGE).toContain('currentKey={step}')
    expect(EDIT_PAGE).toContain('STEP_ORDER.map')
    for (const node of ['K7vg2', 'nzWIX', 'ivDoe']) expect(EDITOR).toContain(node)
    expect(EDITOR).toContain("step === 'basic'")
    expect(EDITOR).toContain("step === 'trigger'")
    expect(EDITOR).toContain("step === 'response'")
  })

  it('4画面を版管理・実行集計・競合集計の実APIへ接続する', () => {
    expect(LIST).toContain('actionExecutionCount')
    expect(LIST).toContain("api.autoReplies.summary(")
    expect(LIST).toContain("summaryRes.data.conflictCount")
    expect(EDIT_PAGE).toContain('api.autoReplies.getDraft(autoReplyId)')
    expect(EDIT_PAGE).toContain('api.autoReplies.conflicts(ruleId)')
    expect(EDIT_PAGE).toContain('formFromSettings(version.settings')
    for (const field of ['internalMemo', 'replyDelaySeconds', 'unmatchedAction', 'expectedVersion']) {
      expect(EDITOR).toContain(field)
    }
    expect(EDITOR).toContain('api.autoReplies.saveDraft(draft.id')
  })

  it('競合画面は現在のルールを含む優先順位と判定例・監視を同時に示す', () => {
    for (const word of ['orderedRules', 'このルール', '試す', '後の処理', "同じ人へ続けて返さない"]) {
      expect(PUBLISH).toContain(word)
    }
    expect(PUBLISH).toMatch(/conflicts\.map\(\(conflict(?:,\s*\w+)?\)/)
    // B-6: 題「LINEプレビュー」は共通部品が出す。画面側は使うだけ。
    expect(PUBLISH).toContain('<LinePreview')
  })

  it('試験結果は候補の優先順位・動かない理由・解除条件と対応中の抑止を説明する', () => {
    // 検証文に当たる候補を全部出し、優先順位で動かない理由も返す。
    expect(PUBLISH).toContain('higher_priority_won')
    expect(PUBLISH).toContain('firstConflictAbove')
    // 有人対応中の抑止対象・解除条件・二重返信の注意を明示する。
    expect(PUBLISH).toContain("operator_handling")
    expect(PUBLISH).toContain('skipWhenOperatorActive')
  })

  it('編集画面の抑止設定は解除条件と対象外の通知を明記する', () => {
    // ページ表示（5段の編集画面）でも抑止設定を変えられる。
    // m20j: 共通 Checkbox（onCheckedChange）へ寄せたため、素の event 式ではなく setter の配線を見る。
    expect(EDITOR).toContain('setSkipWhenOperatorActive')
  })

  it('有効化完了の一時停止と複製を実口へ接続する（NEXT-20）', () => {
    // 停止は一覧と同じ共通の確認窓と専用の停止口へ繋ぐ。
    expect(LIST).toContain("import ConfirmDialog from '@/components/shared/confirm-dialog'")
    expect(LIST).toContain('api.autoReplies.stop(')
    expect(PUBLISH).toContain('crypto.randomUUID()')
    // 複製は対象の設定を写した新しい下書きを作って編集画面へ進む。
    expect(LIST).toContain('api.autoReplies.create(')
    // onClick/href の無い飾りボタンを残さない。
    expect(PUBLISH).not.toContain('<Button><PauseCircle')
  })
})
