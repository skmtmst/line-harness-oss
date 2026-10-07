import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const OPERATOR_RULES = fs.readFileSync(
  path.join(__dirname, 'operator-notification-rules.tsx'),
  'utf8',
)
const OPERATOR_NEW = fs.readFileSync(
  // 2026-10-07：作る・なおす画面は src/v8 に移った。入口が出している画面を見る。
  path.join(__dirname, '../../v8/line-notifications/operator-edit.tsx'),
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
    // 板 u8xibp：受け取る人の実数は summary?.recipients。受け取れない人の内訳は出さない。
    expect(OPERATOR_RULES).toContain('summary?.recipients')
  })

  it('中5: 押せないページ送りの飾りを置かない', () => {
    expect(OPERATOR_RULES).not.toContain('1　2　3')
    // 件数は共通部品 ListRange が「N件中 X〜Y件を表示」の形で出す(#667)。
    expect(OPERATOR_RULES).toContain('ListRange')
  })

  it('中6: 新規作成は保存し直せて、公開前に最新を保存する', () => {
    // 板 gjUz3：下書きボタンは「下書きを保存」の1つ。
    expect(OPERATOR_NEW).toContain('下書きを保存')
    // N-342 (#943): 正本APIの下書き口。作り直さず書き換える。
    expect(OPERATOR_NEW).toContain('operatorRules.updateDraft(savedRuleId')
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

describe('点検・軽: LINE通知の画面契約(#580)', () => {
  const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

  it('軽1: 顧客タブだけ定義・集計を取る', () => {
    expect(PAGE).toContain("tab === 'customer'")
    expect(PAGE).toContain('needCustomer')
    expect(PAGE).toContain('? api.lineNotifications.definitions(selectedAccountId)')
    // 板 g3iDs：LINE上の表示数は出さないので集計は取らない。行は送信履歴の数だけ。
    expect(PAGE).not.toContain('api.lineNotifications.metrics(selectedAccountId)')
    expect(PAGE).toContain('? api.lineNotifications.sendCounts(selectedAccountId)')
    expect(PAGE).toContain('[selectedAccountId, tab]')
  })

  it('軽4: 出す・止めるスイッチに読み上げ名を付ける', () => {
    expect(PAGE).toContain('role="switch"')
    expect(PAGE).toContain('のお知らせを出す・止める')
  })

  it('読み上げ: 運用者知らせの失敗は alert・成功は status で出す', () => {
    expect(OPERATOR_RULES).toContain("role={notice.error ? 'alert' : 'status'}")
    expect(OPERATOR_RULES).toContain('{notice.text}')
  })
})
