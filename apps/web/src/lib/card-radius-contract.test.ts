import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const WEB = path.join(__dirname, '..', '..')
const CSS = fs.readFileSync(path.join(WEB, 'src', 'app', 'globals.css'), 'utf8')

function token(name: string): string {
  const hit = CSS.match(new RegExp(`--${name}:\\s*([^;]+);`))
  return hit ? hit[1].trim() : '(未定義)'
}

/** V8 §6: 中身のカードは12、窓は16。役割を混ぜない。 */
describe('カードと窓の角丸は V8 の役割ごとの段に揃う', () => {
  it('カードは12px', () => {
    // ★V7: 丸みは 6 / 8 / 12 / 999 の4段。カードは 12px。
    expect(token('radius-card')).toBe('12px')
  })

  it('窓は16px', () => {
    // J6x4Q 標準確認モーダル / z7O873 友だち 詳細検索モーダル
    expect(token('radius-panel')).toBe('16px')
  })

  it('用途の名前を別のまま残す', () => {
    // 2つの名前があるので、将来片方だけを変えられる。
    expect(token('radius-card')).not.toBe('(未定義)')
    expect(token('radius-panel')).not.toBe('(未定義)')
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
