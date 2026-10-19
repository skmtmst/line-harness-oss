import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const FEATURE = readFileSync(join(HERE, 'feature-settings-v8.tsx'), 'utf8')
const MANUAL = readFileSync(join(HERE, 'manual-links', 'manual-links-v8.tsx'), 'utf8')
const SCAN = readFileSync(join(HERE, 'file-scan', 'file-scan-v8.tsx'), 'utf8')
const CSS = readFileSync(join(HERE, '../../components/templates/page-templates.module.css'), 'utf8')
const START = readFileSync(join(HERE, '..', 'getting-started', 'page.tsx'), 'utf8')

/*
 * V8 設定の残り（・・）。
 * （状態ごとの見え方）：3画面とも読み込み中・読めなかった・
 * 0件を出し、絞り込み0件には「条件を外す」を付ける。互換経路は変えない。
 * （機能設定1152）：板1100px未満で1列に畳む（同一画面の幅違い）。
 * （はじめの設定）：順路の段に板IDを付ける。
 */
describe('設定の残り板', () => {
  it('機能設定は絞り込み0件、記録の一覧は状態の板を使う', () => {
    expect(FEATURE).toContain('filteredGroups.length === 0')
    expect(FEATURE).toContain('emptyPreset="filtered"')
    expect(MANUAL).toContain("kind={status === 'error' ? 'error' : 'loading'}")
    expect(MANUAL).toContain('kind="empty"')
    expect(SCAN).toContain('kind="error"')
    expect(SCAN).toContain('kind="empty"')
  })

  it('絞り込み0件には条件を外す口がある', () => {
    expect(FEATURE).toContain('条件を外す')
    expect(MANUAL).toContain('条件を外す')
    expect(SCAN).toContain('条件を外す')
  })

  it('1152（bKipf）は板1100px未満で1列に畳む', () => {
    expect(CSS).toContain('@container v8-page (max-width: 1099px)')
    expect(CSS).toContain('.folders { display: none; }')
  })

  it('はじめの設定の順路に板IDを付ける（xuJ7D）', () => {
    expect(START).toMatch(/(?:data-design-node|boardId)="xuJ7D"/)
    expect(START).toMatch(/<GridTable\s+label="はじめの設定の順路"/)
  })
})
