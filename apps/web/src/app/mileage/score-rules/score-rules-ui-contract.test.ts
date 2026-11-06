import { readUiSource as readFileSync } from '../../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api'
import { scoreRuleErrorMessage } from '@/v8/mileage/score-rules'
import { mileageAdjustmentErrorMessage } from '@/v8/mileage/adjust-dialog'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const ADJUSTMENT = readFileSync(
  join(HERE, '..', '..', '..', 'v8', 'mileage', 'adjust-dialog.tsx'),
  'utf8',
)

/*
 * ここは**画面の文字と幅**だけを見る。口とデータは #496 の
 * `mileage-管理画面-contract.test.ts` が見ている。
 */
describe('スコアのルール：失敗の文言', () => {
  it.each([400, 422])('入力理由%sは実関数で安全な日本語だけを残す', status => {
    expect(scoreRuleErrorMessage(new ApiError(status, '名前を直してください'))).toBe('名前を直してください')
    expect(scoreRuleErrorMessage(new ApiError(status, '名前の確認: D1_ERROR SELECT secret FROM tenant'))).not.toMatch(/D1_ERROR|SELECT|secret/)
  })

  it('置き換えた文言に番号や英語を混ぜない', () => {
    /* **返している文だけを見る。** 行ごと見ると `error.status` に当たる。 */
    const returned = [...PAGE.matchAll(/if \(error\.status === (\d{3})\) return '([^']+)'/g)]
    expect(returned.length).toBeGreaterThanOrEqual(4)
    for (const [, status, message] of returned) {
      if (status === '400') continue
      expect(message).not.toMatch(/API|error|status|\d/)
    }
  })

  it('通信そのものが失敗したときも日本語で出す', () => {
    expect(PAGE).toContain('通信に失敗しました。接続を確認してもう一度お試しください。')
  })

  it('手動マイル調整でも安全な入力理由と環境の拒否を残す', () => {
    expect(mileageAdjustmentErrorMessage(new ApiError(400, '理由を入力してください'))).toBe('理由を入力してください')
    expect(mileageAdjustmentErrorMessage(new ApiError(400, 'D1_ERROR SELECT secret FROM tenant'))).not.toMatch(/D1_ERROR|SELECT|secret/)
    expect(mileageAdjustmentErrorMessage(new ApiError(405))).toBe('この環境ではマイル変更を実行できません。')
    for (const status of [403, 404, 405, 409]) expect(scoreRuleErrorMessage(new ApiError(status))).not.toMatch(/API error|status|\d/)
  })

})

describe("スコアのルール：管理画面の配置", () => {
  it('詳しい入力は共通ダイアログで直す', () => {
    expect(PAGE).toContain('title="できごとの設定を直す"')
    expect(PAGE).toContain('setEditRuleIndex(index)')
    expect(PAGE).toContain('setEditRuleIndex(nextIndex)')
    for (const label of ['きっかけ', '点数の変え方', '回数', '開始日時', '終了日時']) {
      expect(PAGE).toContain('label="' + label + '"')
    }
  })

  it('1人で試す操作も共通ダイアログを開く', () => {
    expect(PAGE).toContain('onClick={() => setTestOpen(true)}>1人で試す')
    expect(PAGE).toContain('title="1人でスコアのルールを試す"')
    expect(PAGE).toContain('友だちの点数や履歴は変えません。')
  })
})
