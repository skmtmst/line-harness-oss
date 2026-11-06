import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/* 詳細の窓は 管理画面 共用の v8/conversions/dialogs.tsx にある。 */
const DIALOGS = readFileSync(join(import.meta.dirname, '../../v8/conversions', 'dialogs.tsx'), 'utf8')

/**
 * 外部受信の失敗理由は、口が返すコードをそのまま画面へ出さない（禁止の見張り）。
 * 成果1件の状態・訳した理由・検証の受信・読み込み失敗は v8/conversions/list.test.tsx の
 * 「中身を見る窓」で描画して確かめる。
 */
describe('コンバージョン詳細の業務文言', () => {
  it('生の理由コードをそのまま画面へ出さない', () => {
    expect(DIALOGS).not.toContain('（${event.reason}）')
  })
})
