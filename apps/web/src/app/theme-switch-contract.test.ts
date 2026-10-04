/*
 * ★V8 移行②「テーマの切り替えの仕組み」の固定。
 *
 *   - <html data-theme="v7|v8"> が layout.tsx で出る（既定 v7）
 *   - globals.css の V8 値が [data-theme="v8"] の下にある（v7 に漏れない）
 *   - 担当者の切り替え口が設定画面にある
 *   - 台帳スクリプトが部品・画面を数えられる
 */
import { readUiSource as readFileSync } from '../../scripts/test-ui-source.mjs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectReport } from '../../scripts/theme-migration-report.mjs'

const WEB = join(__dirname, '..', '..')
const layout = readFileSync(join(WEB, 'src/app/layout.tsx'), 'utf8')
const globals = readFileSync(join(WEB, 'src/app/globals.css'), 'utf8')
const settings = readFileSync(join(WEB, 'src/app/settings/page.tsx'), 'utf8')

describe('テーマの切り替え（V8 移行②）', () => {
  it('<html> に data-theme が出る。既定は v7、環境変数 NEXT_PUBLIC_ADMIN_THEME=v8 で v8 にできる', () => {
    expect(layout).toContain('data-theme={ADMIN_THEME}')
    expect(layout).toContain("NEXT_PUBLIC_ADMIN_THEME === 'v8' ? 'v8' : 'v7'")
  })

  it('担当者の localStorage 指定を描画前に反映する短いスクリプトがある', () => {
    expect(layout).toContain("localStorage.getItem('lh-admin-theme')")
    expect(layout).toContain('document.documentElement.dataset.theme')
  })

  it('V8 の値は [data-theme="v8"] の下にだけある（角丸 control 10 / panel 16）', () => {
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

  it('設定画面の奥に切り替えがある', () => {
    expect(settings).toContain('ThemePreviewSwitch')
  })

  it('G6：検証環境の既定は V8・本番は付けない（v7 のまま）', () => {
    const staging = readFileSync(join(WEB, '..', '..', '.github', 'workflows', 'deploy-cloudflare-staging.yml'), 'utf8')
    expect(staging).toContain("NEXT_PUBLIC_ADMIN_THEME: 'v8'")
    const prod = readFileSync(join(WEB, '..', '..', '.github', 'workflows', 'deploy-cloudflare-admin.yml'), 'utf8')
    expect(prod).not.toContain('NEXT_PUBLIC_ADMIN_THEME')
  })

  it('G6：上バーに「前の見た目に戻す」があり、V8 のときだけ渡す', () => {
    const topBar = readFileSync(join(WEB, 'src', 'components', 'shared', 'top-bar.tsx'), 'utf8')
    const appTopBar = readFileSync(join(WEB, 'src', 'components', 'shell', 'app-top-bar.tsx'), 'utf8')
    expect(topBar).toContain('前の見た目に戻す')
    expect(topBar).toContain('onRevertTheme')
    expect(appTopBar).toContain("applyAdminTheme('v7')")
    expect(appTopBar).toContain("=== 'v8'")
  })

  // 画面列挙でリポジトリを走査するため CI の遅い環境でも間に合う余裕を持つ。
  it('台帳が部品ごと・画面ごとの状態を数える', { timeout: 60_000 }, () => {
    const report = collectReport()
    expect(report.parts.length).toBeGreaterThan(30)
    expect(report.screens.length).toBeGreaterThan(100)
    for (const p of report.parts) {
      expect(['v8対応済み', 'v7 のまま', '未作成', 'コード不明']).toContain(p.status)
    }
    for (const s of report.screens) {
      expect(['v8対応済み', 'v7 のまま', '部品なし']).toContain(s.status)
    }
  })
})
