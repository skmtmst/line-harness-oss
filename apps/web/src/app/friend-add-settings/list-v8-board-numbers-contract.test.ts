import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 友だち追加時の配信の一覧と板 `MRhef` の数値突き合わせ（2026-10-03）。
 * 見本の数字が変わったらここも直す。共通部品の中身は M10 の持ち物なので見ない。
 *
 * 2026-10-07：入口は src/v8/friend-add/list.tsx（古い list-v8.tsx はもう描かれない）。
 * 新しい一覧は寸法を共通の値（globals.css の --tpl-fa-*）から読むので、値の中身まで確かめる。
 * 数の帯は共通部品（KpiBand・KpiCard）に移ったので、その寸法は共通部品の試験が見張る（ここでは見ない）。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(HERE, '../../v8/friend-add/list.module.css'), 'utf8')
const tsx = readFileSync(join(HERE, '../../v8/friend-add/list.tsx'), 'utf8')
const GLOBALS = readFileSync(join(HERE, '../globals.css'), 'utf8')
const token = (name: string) => GLOBALS.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.trim()

describe('友だち追加時の配信の一覧は板 MRhef の数字どおり', () => {
  it('表の見出し・行の余白は 12/24', () => {
    expect(css).toMatch(/\.table \.headRow\[data-table-layout='columns'\] \{[^}]*padding: var\(--tpl-fa-head-pad\)/s)
    expect(token('--tpl-fa-head-pad')).toBe('12px 24px')
    expect(css).toMatch(/\.table \.row\[data-table-layout='columns'\] \{[^}]*padding: var\(--tpl-fa-row-pad\)/s)
    expect(css).toMatch(/\.table \.row\[data-table-layout='columns'\] \{[^}]*align-items: center/s)
    expect(token('--tpl-fa-row-pad')).toBe('12px 24px')
  })

  it('列幅は順 28・設定は伸び縮み・最初に送るもの 170・状態 80・直近7日 64・操作 28', () => {
    for (const [cls, name] of [
      ['colOrder', '--tpl-fa-col-order'], ['colSend', '--tpl-fa-col-send'], ['colStatus', '--tpl-fa-col-status'],
      ['colRecent', '--tpl-fa-col-recent'], ['colMenu', '--tpl-fa-col-menu'],
    ]) {
      expect(css, cls).toMatch(new RegExp(`\\.${cls} \\{ width: var\\(${name}\\)`))
      expect(tsx, cls).toContain(`styles.${cls}`)
    }
    expect(token('--tpl-fa-col-order')).toBe('28px')
    expect(token('--tpl-fa-col-send')).toBe('170px')
    expect(token('--tpl-fa-col-status')).toBe('80px')
    expect(token('--tpl-fa-col-recent')).toBe('64px')
    expect(token('--tpl-fa-col-menu')).toBe('28px')
    expect(css).toMatch(/> th\.colName,[\s\S]*?> td\.colName \{[^}]*flex: 1 1 0/)
  })

  it('探す欄の幅は 220', () => {
    expect(css).toMatch(/\.searchBox \{ width: var\(--tpl-fa-search-w\)/)
    expect(token('--tpl-fa-search-w')).toBe('220px')
  })
})
