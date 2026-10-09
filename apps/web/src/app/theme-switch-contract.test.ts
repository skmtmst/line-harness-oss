/*
 * 見た目は常に V8（2026-10-09 オーナー決定「全画面を V8 に固定」）。
 *
 *   - <html data-theme="v8"> を layout.tsx が固定で出す（環境変数・ブラウザの記憶を読まない）
 *   - 描画前に data-theme を差し替えるスクリプトは無い（v7 が一瞬出ない）
 *   - 設定画面に「画面の見た目」の切り替えは無い
 *   - 配備の設定に NEXT_PUBLIC_ADMIN_THEME は要らない
 *   - globals.css の V8 値は [data-theme="v8"] の下にある
 */
import { readUiSource as readFileSync } from '../../scripts/test-ui-source.mjs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const WEB = join(__dirname, '..', '..')
const ROOT = join(WEB, '..', '..')
const layout = readFileSync(join(WEB, 'src/app/layout.tsx'), 'utf8')
const globals = readFileSync(join(WEB, 'src/app/globals.css'), 'utf8')
const settings = readFileSync(join(WEB, 'src/v8/settings/features/screen.tsx'), 'utf8')

describe('見た目は V8 に固定', () => {
  it('<html> は data-theme="v8" を固定で出す', () => {
    expect(layout).toContain('data-theme="v8"')
    expect(layout).not.toContain('data-theme={')
    expect(layout).not.toContain('adminThemeDefault')
    expect(layout).not.toContain('NEXT_PUBLIC_ADMIN_THEME')
  })

  it('このブラウザの記憶（lh-admin-theme）を読む描画前のスクリプトは無い', () => {
    expect(layout).not.toContain('lh-admin-theme')
    expect(layout).not.toContain('THEME_BOOT')
    expect(layout).not.toContain('dangerouslySetInnerHTML')
  })

  it('設定画面に「画面の見た目」の切り替えは無い', () => {
    expect(settings).not.toContain('data-design="theme-preview"')
    expect(settings).not.toContain('applyAdminTheme')
    expect(existsSync(join(WEB, 'src/components/theme-preview-switch.tsx'))).toBe(false)
  })

  it('配備（検証・本番）と検証配備の手順に見た目の指定は無い', () => {
    for (const file of [
      '.github/workflows/deploy-cloudflare-staging.yml',
      '.github/workflows/deploy-cloudflare-admin.yml',
      'scripts/deploy/staging-deploy.sh',
    ]) {
      expect(readFileSync(join(ROOT, file), 'utf8'), file).not.toContain('NEXT_PUBLIC_ADMIN_THEME')
    }
  })

  it('V8 の値は [data-theme="v8"] の下にある（角丸 control 10 / panel 16）', () => {
    const v8 = globals.match(/\[data-theme="v8"\]\s*\{([\s\S]*?)\}/)
    expect(v8, '[data-theme="v8"] ブロックが無い').not.toBeNull()
    expect(v8![1]).toContain('--radius-control: 10px')
    expect(v8![1]).toContain('--radius-panel: 16px')
  })

  it('V8 で増える語彙がある（divider・table-head・chat-outgoing・board・印のタイル）', () => {
    for (const token of [
      '--color-divider: #eceef1',
      '--color-table-head: #fafafb',
      '--color-chat-outgoing: #dff5e7',
      '--color-board-line',
      '--shadow-board',
      '--color-icon-tile-green',
      '--color-icon-tile-red',
    ]) {
      expect(globals).toContain(token)
    }
  })

  it('上バーに「前の見た目に戻す」は無い（オーナー指示で廃止）', () => {
    const topBar = readFileSync(join(WEB, 'src', 'components', 'shared', 'top-bar.tsx'), 'utf8')
    const appTopBar = readFileSync(join(WEB, 'src', 'components', 'shell', 'app-top-bar.tsx'), 'utf8')
    expect(topBar).not.toContain('前の見た目に戻す')
    expect(topBar).not.toContain('onRevertTheme')
    expect(appTopBar).not.toContain('onRevertTheme')
    expect(appTopBar).not.toContain("applyAdminTheme('v7')")
  })
})
