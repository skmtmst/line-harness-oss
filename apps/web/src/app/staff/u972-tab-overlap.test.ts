import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

const CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../v8/settings/staff/staff.module.css'), 'utf8')

describe('U031 スタッフのタブと追加操作の重なり', () => {
  it('現役のタブは折り返し、招待操作は道具の段に分ける', () => {
    expect(CSS).toMatch(/\.tabs\s*{[^}]*flex-wrap: wrap/s)
    expect(CSS).toMatch(/\.tab\s*{[^}]*white-space: nowrap/s)
    expect(PAGE).toContain('<div className={styles.toolbar}>')
    expect(PAGE).toContain('href="/staff/new"')
    expect(PAGE).not.toContain('data-tabs-row><Tabs')
  })
})
