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
 * **カードと窓の角丸は、名前を分けたまま同じ 12px へ畳む（★V7）。**
 *
 * V6 ではカードが `$radius-md`(10)、窓が `$radius-panel`(12) と別物だった。
 * ★V7「見た目の物差し」§1 で丸みは 6 / 8 / 12 / 999 の4段だけになり、
 * 「カード・ダイアログ・知らせ」は同じ 12px 段に入る。
 * 値が同じでも名前は用途ごとに残す。画面側の `rounded-card` /
 * `rounded-panel` は触らず、ここで値だけが読み替わる。
 */
describe('カードと窓の角丸は V7 の 12px 段に揃う', () => {
  it('カードは V7 の12px', () => {
    // ★V7: 丸みは 6 / 8 / 12 / 999 の4段。カードは 12px。
    expect(token('radius-card')).toBe('12px')
  })

  it('窓は V7 の12px', () => {
    // J6x4Q 標準確認モーダル / z7O873 友だち 詳細検索モーダル
    expect(token('radius-panel')).toBe('12px')
  })

  it('値が同じでも、用途の名前は別のまま残す', () => {
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
