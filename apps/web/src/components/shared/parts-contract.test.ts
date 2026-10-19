import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const read = (name: string) => readFileSync(join(here, name), 'utf8')

describe('V6共通部品の実装境界', () => {
  it('押せる部品はキーボードフォーカスを表示する', () => {
    for (const name of [
      'tabs.module.css',
      'breadcrumb.module.css',
      'toggle.module.css',
      'select.module.css',
      'text-field.module.css',
      'row-actions.module.css',
      'side-cards.module.css',
      'radio-card.module.css',
    ]) {
      expect(read(name), `${name} に :focus-visible がない`).toContain(':focus-visible')
    }
  })
})
