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
  it('3画面とも0件の状態に板IDを付ける（bR6a1）', () => {
    expect(FEATURE).toContain('data-design-node="bR6a1"')
    expect(MANUAL).toContain('data-design-node="bR6a1"')
    expect(SCAN).toContain('data-design-node="bR6a1"')
  })

  it('絞り込み0件には条件を外す口がある', () => {
    expect(FEATURE).toContain('条件を外す')
    expect(MANUAL).toContain('条件を外す')
    expect(SCAN).toContain('条件を外す')
  })

  it('1152（bKipf）は板1100px未満で畳む', () => {
    expect(CSS).toContain('@media (max-width: 1100px)')
  })

  it('はじめの設定の順路に板IDを付ける（BOj1a・V8だけ）', () => {
    expect(START).toContain("data-design-node={theme === 'v8' ? 'BOj1a' : undefined}")
  })

  it('機能設定の競合は帯・比べる・読み直しを出す（ziYCN）', () => {
    expect(HOOK).toContain('setConflict(true)')
    expect(FEATURE).toContain('data-design-node="ziYCN"')
    expect(FEATURE).toContain('ほかの人が機能設定を保存しました')
    expect(FEATURE).toContain('違いを比べる')
    expect(FEATURE).toContain('最新を読み込んで続ける')
    expect(FEATURE).toContain('比べてから保存')
  })
})
