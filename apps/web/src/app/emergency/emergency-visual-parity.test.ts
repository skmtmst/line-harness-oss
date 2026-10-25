import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = ['../../v8/settings/emergency/screen.tsx', '../../v8/settings/emergency/health.tsx', '../../v8/emergency/control.tsx', '../../v8/settings/emergency/history.tsx'].map((file) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), file), 'utf8')).join('\n')

/** 注釈を落とす。**「なぜ h1 をやめたか」を書いた注釈が見張りに当たらないように。** */
const visible = source
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

/**
 * 板 Y4LkX1 運用状態（健全性チェック・更新履歴・緊急コントロール）の、旧形へ戻らない見張り。
 *
 * 見える物と動きは描いて見る：
 * - 板・タブの並び・題が1つ・タブごとの説明＝v8/settings/emergency/screen.test.tsx
 * - 9行の並び・結果の対応・古い確認・5分ごとの取り直し・下の3枚＝v8/settings/emergency/health-panel.test.tsx、manual-health-run-guard.test.tsx
 * - 停止・復旧・本人確認・自動応答も止める＝control-v8-react.test.tsx、emergency-control-mount.test.ts、restore-drift.test.tsx
 * - 停止履歴と配備履歴の分け方＝operation-history-summary.test.tsx、v8/settings/emergency/history-icons.test.tsx
 */
describe('Y4LkX1 運用状態の旧形へ戻らない', () => {
  it('h1 を重ねない', () => {
    expect(visible).not.toMatch(/<h1[\s>]/)
  })

  it('項目の数を数字で固定しない（定義の実体から決める）', () => {
    expect(visible).not.toMatch(/const CHECK_COUNT = \d+/)
  })

  it('古い健全性の口・画面だけの保存・公開できない鍵を使わない', () => {
    expect(source).not.toContain('api.health.getHealth')
    expect(source).not.toContain('nen_emergency_snapshot_v1')
    expect(source).not.toContain('NEXT_PUBLIC_ADMIN_API_KEY')
  })
})
