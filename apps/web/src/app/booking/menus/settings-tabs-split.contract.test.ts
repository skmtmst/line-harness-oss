import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * 速さのため、予約設定V8の使わないタブは後から読む。
 * 流儀は v6-contract と同じ（描画試験はしない。文面を読む）。
 * 見た目・動きは変えない。殻だけ先に読み、開いているタブの束と
 * ほかは選ばれてから読む。殻の描き直しがタブの中まで波及しない。
 */

const ROOT = join(process.cwd(), 'src', 'app', 'booking', 'menus')
const src = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), 'utf8')
const SHELL = src('settings-v8.tsx')
const TABS = [
  'menus-tab.tsx',
  'hours-tab.tsx',
  'holidays-tab.tsx',
  'rules-tab.tsx',
  'staff-tab.tsx',
] as const

describe('使わないタブは後から読む（動的 import）', () => {
  it('5つのタブを動的 import で読む', () => {
    expect(SHELL).toContain("from 'next/dynamic'")
    for (const tab of TABS) {
      expect(SHELL).toContain(`import('./settings-tabs/${tab.replace(/\.tsx$/, '')}')`)
    }
  })

  it('タブの中身を殻に静かに入れない（開く前の束に入れない）', () => {
    for (const tab of TABS) {
      const name = tab.replace(/\.tsx$/, '')
      expect(SHELL).not.toContain(`from './settings-tabs/${name}'`)
    }
    for (const component of ['MenusTabV8', 'HoursTabV8', 'HolidaysTabV8', 'RulesTabV8', 'StaffTabV8']) {
      expect(SHELL).not.toContain(`function ${component}(`)
    }
  })

  it('タブの部品は別束に分かれている', () => {
    const bodies = TABS.map((tab) => src('settings-tabs', tab))
    for (const [index, body] of bodies.entries()) {
      expect(body).toContain("'use client'")
      // ほかのタブの部品を静かに入れない（束が1つに戻らない）。
      for (const [otherIndex, other] of TABS.entries()) {
        if (otherIndex === index) continue
        expect(body).not.toContain(`from './${other.replace(/\.tsx$/, '')}'`)
      }
    }
  })

  it('読み待ちは骨組みで段を保つ', () => {
    expect(SHELL.match(/loading: \(\) => <SkeletonRows/g)?.length).toBe(5)
  })
})

describe('殻の描き直しをタブの中へ波及させない', () => {
  it('タブの包みは memo（同じ中身では描き直さない）', () => {
    expect(SHELL.match(/memo\(dynamic\(/g)?.length).toBe(5)
  })

  it('タブへ渡す手は固定する（useCallback）', () => {
    for (const name of ['reloadCore', 'saveSettings', 'saveResource', 'createResource', 'deleteResource', 'retryResources']) {
      expect(SHELL).toContain(`const ${name} = useCallback(`)
    }
    expect(SHELL).toContain('onReload={reloadCore}')
    expect(SHELL).toContain('onSaved={saveSettings}')
    expect(SHELL).not.toContain('onReload={() => void loadCore()}')
  })

  it('書きかけの登録口は1つ（タブ共通）', () => {
    expect(SHELL).toContain('V8TabEditContext')
    expect(src('settings-tabs', 'shared.tsx')).toContain('export const V8TabEditContext')
  })
})
