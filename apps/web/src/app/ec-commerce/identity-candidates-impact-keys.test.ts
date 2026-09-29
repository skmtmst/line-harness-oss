import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ORDER_IMPACT_KEYS, REVENUE_IMPACT_KEYS } from '@line-crm/shared'

/*
 * #517 軽4: 計量キーの手書き重複を共有の正本へ寄せた。キー名がずれると
 * 画面が黙って「—(未取得)」になり、型でも守れない。ここは共有の一覧を
 * 本物で import し、見本のキーが1つ残らず収まることと、手書きの一覧が
 * 復活していないことを見張る。
 *
 * - K1: 見本(EC_IDENTITY_CANDIDATES)の計量キーは、すべて共有の一覧に収まる
 * - K2: 表示側に手書きのキー一覧が無い(共有から import する)
 * - K3: 集計側に手書きのキー一覧が無い(共有から import する)
 */

const KNOWN = new Set<string>([...ORDER_IMPACT_KEYS, ...REVENUE_IMPACT_KEYS])

function fixtureImpactKeys(): string[] {
  const fixtures = readFileSync(join(import.meta.dirname, '..', '..', '..', '..', '..', 'scripts', 'visual-qa', 'fixtures.mjs'), 'utf8')
  const start = fixtures.indexOf('export const EC_IDENTITY_CANDIDATES')
  const end = fixtures.indexOf('export const MILEAGE_REWARDS')
  if (start < 0 || end < start) throw new Error('EC_IDENTITY_CANDIDATES が見本に見つかりません')
  const section = fixtures.slice(start, end)
  const keys: string[] = []
  const pattern = /\{ key: '([a-z0-9_]+)', value:/g
  let found: RegExpExecArray | null
  while ((found = pattern.exec(section)) !== null) keys.push(found[1])
  if (keys.length === 0) throw new Error('見本から計量キーを拾えませんでした')
  return keys
}

describe('EC計量キーの共有(#517 軽4)', () => {
  it('K1: 見本の計量キーはすべて共有の一覧に収まる(未知は赤)', () => {
    const keys = fixtureImpactKeys()
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) {
      expect(KNOWN.has(key), `未知の計量キー: ${key}`).toBe(true)
    }
  })

  it('K2: 表示側に手書きのキー一覧が無い', () => {
    const page = readFileSync(join(import.meta.dirname, 'identity-candidates', 'page.tsx'), 'utf8')
    expect(page).toContain('ORDER_IMPACT_KEYS')
    expect(page).toContain('REVENUE_IMPACT_KEYS')
    expect(page).not.toContain("'order_count'")
    expect(page).not.toContain("'order_amount'")
    expect(page).not.toContain("['sales', 'revenue', 'order_amount']")
    expect(page).not.toContain("['orders', 'order_count']")
  })

  it('K3: 集計側に手書きのキー一覧が無い', () => {
    const operations = readFileSync(join(import.meta.dirname, '..', '..', '..', '..', '..', 'packages', 'db', 'src', 'ec-operations.ts'), 'utf8')
    expect(operations).toContain('REVENUE_IMPACT_KEYS')
    expect(operations).not.toContain("['sales', 'revenue', 'order_amount']")
  })
})
