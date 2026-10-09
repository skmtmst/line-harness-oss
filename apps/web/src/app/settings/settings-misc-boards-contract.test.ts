import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const FEATURE = readFileSync(join(HERE, 'feature-settings-v8.tsx'), 'utf8')
const MANUAL = readFileSync(join(HERE, 'manual-links', 'manual-links-v8.tsx'), 'utf8')
const SCAN = readFileSync(join(HERE, 'file-scan', 'file-scan-v8.tsx'), 'utf8')
const HOOK = readFileSync(join(HERE, 'use-feature-settings.ts'), 'utf8')
const CSS = readFileSync(join(HERE, 'settings-v8.module.css'), 'utf8')
const START = readFileSync(join(HERE, '..', 'getting-started', 'page.tsx'), 'utf8')

/*
 * V8 設定の細かい板（bR6a1・bKipf・BOj1a・ziYCN）。
 * `bR6a1`（状態ごとの見え方）：3画面とも0件に板IDと「条件を外す」。
 * `bKipf`（機能設定1152）：板1100px未満で畳む（同一画面の幅違い）。
 * `BOj1a`（はじめの設定）：順路の段に板ID。
 * `ziYCN`（機能設定の競合）：帯で知らせ、比べる・読み直しを出す。
 * 会社とロゴ（`uAWb7`）は読み書きの口が無いので作らない。
 * v7 は変えない。
 */
describe('設定の細かい板', () => {
  it('機能設定は共通の絞り込み0件、残り2画面はbR6a1を使う', () => {
    expect(FEATURE).toContain('filteredGroups.length === 0')
    expect(FEATURE).toContain('emptyPreset="filtered"')
    expect(FEATURE).toContain("onClick={() => setQuery('')}")
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

  it('1152（bKipf）は板1100px未満で畳む', () => {
    expect(CSS).toContain('@media (max-width: 1100px)')
  })

  it('はじめの設定の順路に板IDを付ける（BOj1a）', () => {
    expect(START).toMatch(/(?:data-design-node|boardId)="BOj1a"/)
  })

  it('機能設定の競合は帯・比べる・読み直しを出す（ziYCN）', () => {
    expect(HOOK).toContain('setConflict(true)')
    expect(FEATURE).toMatch(/(?:data-design-node|boardId)="ziYCN"/)
    expect(FEATURE).toContain('ほかの人が先に機能設定を保存しました')
    expect(FEATURE).toContain('<SaveConflictBand')
    expect(FEATURE).toContain('onCompare={() => setCompareOpen(true)}')
    expect(FEATURE).toContain('onReload={() => void load()}')
    expect(FEATURE).toContain('比べてから保存')
  })
})
