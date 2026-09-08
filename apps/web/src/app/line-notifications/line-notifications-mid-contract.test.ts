import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const OPERATOR_RULES = fs.readFileSync(
  path.join(__dirname, 'operator-notification-rules.tsx'),
  'utf8',
)
const OPERATOR_NEW = fs.readFileSync(
  path.join(__dirname, 'operator/new/page.tsx'),
  'utf8',
)
const RUN_LIST = fs.readFileSync(
  path.join(__dirname, '../../components/line-notifications/notification-run-list.tsx'),
  'utf8',
)

describe('点検・中: LINE通知の画面契約', () => {
  it('中4: 運用者一覧の補足数字は書き置きでなく実数を出す', () => {
    expect(OPERATOR_RULES).not.toContain('うち止めている 2')
    expect(OPERATOR_RULES).not.toContain('3つのチームに')
    expect(OPERATOR_RULES).toContain('summary?.stopped')
    expect(OPERATOR_RULES).toContain('summary?.missingRecipients')
  })

  it('中5: 押せないページ送りの飾りを置かない', () => {
    expect(OPERATOR_RULES).not.toContain('1　2　3')
    expect(OPERATOR_RULES).toContain('件中')
  })

  it('中6: 新規作成は保存し直せて、公開前に最新を保存する', () => {
    expect(OPERATOR_NEW).toContain('保存し直す')
    expect(OPERATOR_NEW).toContain('rules.update(savedRuleId')
    expect(OPERATOR_NEW).not.toContain('savedRuleId ?? await saveDraft()')
  })

  it('中7: 記録の検索は表示中の範囲だけと分かる', () => {
    expect(RUN_LIST).toContain('表示中の20件のみ')
  })

  it('中8: 互換口への戻しは404のとき1回だけ', () => {
    expect(RUN_LIST).toContain('fellBack')
    expect(RUN_LIST).toContain('!fellBack')
  })

  it('中9: 再試行ボタンは店長だけに出し、権限不足の文言を持つ', () => {
    expect(RUN_LIST).toContain('canRetry')
    expect(RUN_LIST).toContain("response.data.role === 'owner'")
    expect(RUN_LIST).toContain('送信の再試行は店長だけができます')
  })

  it('中11: テスト送信の成功は成功枠で出す', () => {
    expect(OPERATOR_NEW).toContain('role="status"')
    expect(OPERATOR_NEW).toContain('自分へのテスト送信を受け付けました')
  })
})
