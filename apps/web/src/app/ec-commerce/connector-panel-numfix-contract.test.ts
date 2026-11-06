import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * EC連携つなぎ先（）の数字の契約。
 * 見本 `lint/V8-B/.html` との突き合わせ（2026-10-03）。
 * 箱は余白16・題は16/600・入力は高さ36・選ぶ欄は折り返す1行。
 * 700の太字は使わない（管理画面の決まり）。
 */

const CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../v8/settings/ec-commerce/connector.module.css'), 'utf8')

function block(selector: string): string {
  const name = selector.replace('.', '')
  const found = CSS.match(new RegExp(`\\.${name}[^{]*\\{([^}]*)\\}`, 's'))
  if (!found) throw new Error(`${selector} が見つかりません`)
  return found[1]
}

describe('EC連携つなぎ先の数字（iLJmw）', () => {
  it('箱は余白16・題は16の600', () => {
    const card = readFileSync(join(import.meta.dirname, '../../components/shared/card.module.css'), 'utf8')
    const source = readFileSync(join(import.meta.dirname, '../../v8/settings/ec-commerce/connector.tsx'), 'utf8')
    expect(source).toContain('<Card spacing="settings"')
    expect(card).toContain('padding: var(--card-content-padding, 0)')
    expect(block('.cardTitle')).toContain('font-size: var(--tpl-rest3-ec-title)')
    expect(block('.cardTitle')).toContain('font-weight: 600')
    expect(block('.cardTitle')).not.toContain('700')
  })

  it('選ぶ欄は2列に割らず折り返す', () => {
    expect(block('.checks')).toContain('flex-wrap: wrap')
    expect(block('.checks')).not.toContain('grid-template-columns')
  })
})
