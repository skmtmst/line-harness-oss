import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const WEB = path.join(__dirname, '..', '..')
const CSS = fs.readFileSync(path.join(WEB, 'src', 'app', 'globals.css'), 'utf8')

function token(name: string): string {
  const hit = CSS.match(new RegExp(`--${name}:\\s*([^;]+);`))
  return hit ? hit[1].trim() : '(未定義)'
}

/**
 * **カードと窓を同じ角丸にしない。**
 *
 * 以前は `--radius-card` も `--radius-panel` も 12px で、1つの値が
 * 「画面のカード」と「モーダルの外枠」の両方を指していた。設計では
 * 別物で、カードは `$radius-md`(10)、窓は `$radius-panel`(12)。
 * 片方に合わせるともう片方がずれるので、用途で分けてある。
 */
describe('カードと窓の角丸を用途で分ける', () => {
  it('カードは設計の10px', () => {
    // pRHvc 検索と絞り込み / k4Hz0X 友だち一覧カード / eHPwj 一括操作バー
    expect(token('radius-card')).toBe('10px')
  })

  it('窓は設計の12px', () => {
    // J6x4Q 標準確認モーダル / z7O873 友だち 詳細検索モーダル
    expect(token('radius-panel')).toBe('12px')
  })

  it('同じ値へ戻していない', () => {
    expect(token('radius-card')).not.toBe(token('radius-panel'))
  })

  it('窓の外枠がカードの角丸を使っていない', () => {
    const dialogs = [
      'app/mileage/friends/detail/mileage-adjustment-dialog.tsx',
      'components/forms/options-dialog.tsx',
      'components/shared/folder-add-dialog.tsx',
      'components/dashboard/qr-dialog.tsx',
      'components/scenarios/scenario-dialogs.tsx',
      'components/chats/saved-view-dialog.tsx',
    ]
    for (const rel of dialogs) {
      const src = fs.readFileSync(path.join(WEB, 'src', rel), 'utf8')
      expect(src, `${rel} が窓にカードの角丸を使っている`).not.toContain('rounded-card')
    }
    const css = fs.readFileSync(
      path.join(WEB, 'src', 'components', 'friends', 'bulk-run-dialog.module.css'),
      'utf8',
    )
    expect(css).not.toContain('var(--radius-card)')
  })
})
