import { describe, expect, it } from 'vitest'
import {
  completedDestinationWrites,
  destinationWriteText,
  nextVisitPeople,
  postActionsNeedRetry,
  postActionsText,
  postActionStepLabel,
  type FormSubmissionSummary,
} from './response-summary'

const summary: FormSubmissionSummary = {
  startedUnique: 2058,
  submitted: 1284,
  completionRate: 62.4,
  destinationWrites: {
    pending: 0,
    succeeded: 1278,
    partial: 3,
    failed: 3,
    not_requested: 0,
    unknown: 0,
  },
  dateAnsweredUniqueFriends: 900,
  dateFields: [{
    key: 'next_visit',
    label: '次回来店の希望日',
    answered: 895,
    uniqueFriends: 892,
    minDate: '2026-08-30',
    maxDate: '2026-09-20',
  }],
}

describe('回答フォームの全件集計表示', () => {
  it('成功と一部成功を、情報欄へ書けた回答として数える', () => {
    expect(completedDestinationWrites(summary)).toBe(1281)
    expect(completedDestinationWrites(null)).toBeNull()
  })

  it('次回来店日があれば、その項目の重複を除いた人数を優先する', () => {
    expect(nextVisitPeople(summary)).toBe(892)
    expect(nextVisitPeople({ ...summary, dateFields: [] })).toBe(900)
    expect(nextVisitPeople(null)).toBeNull()
  })

  it('回答ごとの書き込み成否と件数を運用者向けに言い分ける', () => {
    expect(destinationWriteText({ status: 'succeeded', attempted: 3, succeeded: 3, failed: 0 }))
      .toBe('書き込み済み（3/3件を書き込み）')
    expect(destinationWriteText({ status: 'partial', attempted: 3, succeeded: 2, failed: 1 }))
      .toBe('一部を書き込み（2/3件を書き込み）')
    expect(destinationWriteText({ status: 'failed', attempted: 2, succeeded: 0, failed: 2 }))
      .toBe('書き込めませんでした（0/2件を書き込み）')
    expect(destinationWriteText(undefined)).toContain('取得できませんでした')
  })
})

describe('回答後アクションの未完表示(N-168)', () => {
  it('未完の工程名を運用者向けの言葉にする', () => {
    expect(postActionStepLabel('reply')).toBe('確認メッセージの送信')
    expect(postActionStepLabel('tag')).toBe('タグ付け')
    expect(postActionStepLabel('layout:afterAction:0')).toBe('回答後アクション')
    expect(postActionStepLabel('layout:destinations:blk1')).toBe('登録先への書き込み')
    expect(postActionStepLabel('unknown-step')).toBe('unknown-step')
  })

  it('未完があるときだけ再実行の口を出す', () => {
    expect(postActionsNeedRetry({ state: 'failed', pending: ['reply'] })).toBe(true)
    expect(postActionsNeedRetry({ state: 'in_progress', pending: ['tag'] })).toBe(true)
    expect(postActionsNeedRetry({ state: 'completed', pending: [] })).toBe(false)
    expect(postActionsNeedRetry({ state: 'untracked', pending: [] })).toBe(false)
    expect(postActionsNeedRetry(null)).toBe(false)
    expect(postActionsNeedRetry(undefined)).toBe(false)
  })

  it('状態ごとに結果を言い分ける。未完なら工程名を出す', () => {
    expect(postActionsText({ state: 'completed', pending: [] })).toBe('すべて完了')
    expect(postActionsText({ state: 'failed', pending: ['reply', 'tag'] }))
      .toBe('未完: 確認メッセージの送信、タグ付け')
    expect(postActionsText({ state: 'in_progress', pending: ['reply'] }))
      .toBe('処理中です（未完: 確認メッセージの送信）')
    expect(postActionsText({ state: 'failed', pending: [] })).toBe('中断しています')
    expect(postActionsText(null)).toContain('記録がありません')
  })
})
