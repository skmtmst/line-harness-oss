import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const TABLE = readFileSync(new URL('../../app/users/users-screen.tsx', import.meta.url), 'utf8')
const CSS = readFileSync(new URL('../../app/friends/friends-v8.module.css', import.meta.url), 'utf8')

describe('統合ユーザーの表の左右の余白', () => {
  it('見出し行の左端と右端は現役の12px', () => {
    expect(TABLE).toContain('<table className={styles.table}>')
    expect(CSS).toMatch(/\.table th\s*{[^}]*padding:\s*10px 12px/s)
  })
  it('本文行の左端と右端は現役の12px', () => {
    expect(TABLE).toContain('<td>')
    expect(CSS).toMatch(/\.table td\s*{[^}]*padding:\s*12px;/s)
  })
})
