import { readUiSource } from '../../../scripts/test-ui-source.mjs'

import { describe, expect, it } from 'vitest'

const PUBLISH = readUiSource(new URL('../../v8/auto-replies/edit/wizard.tsx', import.meta.url), 'utf8')
const LIST = readUiSource(new URL('../../v8/auto-replies/list.tsx', import.meta.url), 'utf8')
const EDIT_PAGE = readUiSource(new URL('../../v8/auto-replies/edit/wizard.tsx', import.meta.url), 'utf8')

describe("管理画面 自動応答一覧の契約", () => {

  it('順番は一覧の「評価順」で上下を入れ替えて決める（R28）', () => {
    // 新しい口は足さず、既存の更新口で隣と数字を交換する。
    expect(LIST).toContain('movePriorityUpdates')
    expect(LIST).toContain("sortKey !== 'priority'")
  })

  it('公開前テストは実在する友だちを選び、本番と同じdry-run APIへ渡す', () => {
    expect(PUBLISH).toContain('api.friends.list({')
    expect(PUBLISH).toContain('friendId: selectedFriendId')
    expect(PUBLISH).toContain('api.autoReplies.testDraft(ruleId')
    expect(PUBLISH).toContain("setDryRun(res.data)")
  })

  it('取得できなかった過去28日の数を0件に見せない', () => {
    expect(PUBLISH).toContain("matchedLast28Days == null ? emptyValue('unknown')")
    expect(PUBLISH).toContain('`${formatNumber(matchedLast28Days)}件`')
  })

  it('4画面を版管理・実行集計・競合集計の実APIへ接続する', () => {
    expect(LIST).toContain('actionExecutionCount')
    expect(LIST).toContain("api.autoReplies.summary(")
    expect(LIST).toContain("summaryRes.data.conflictCount")
    expect(EDIT_PAGE).toContain('api.autoReplies.getDraft(autoReplyId)')
    expect(EDIT_PAGE).toContain('api.autoReplies.conflicts(ruleId)')
    expect(EDIT_PAGE).toContain('formFromSettings(version.settings')
  })

  it('競合画面は現在のルールを含む優先順位と判定例・監視を同時に示す', () => {
    for (const word of ['orderedRules', 'このルール', '試す', '後の処理', "同じ人へ続けて返さない"]) {
      expect(PUBLISH).toContain(word)
    }
    expect(PUBLISH).toMatch(/conflicts\.map\(\(conflict(?:,\s*\w+)?\)/)
    // : 題「LINEプレビュー」は共通部品が出す。画面側は使うだけ。
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
