import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const EDITOR = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'editor-v8.tsx'), 'utf8')

/** 作る②の流入リンクの重なり案内（板 `kFz4b`）の歯止め。 */
describe('kFz4b 流入リンクの重なり案内', () => {
  it('ほかの設定が使っている流入リンクは選べない形にし、名前を出す', () => {
    expect(EDITOR).toContain('routeUse')
    expect(EDITOR).toContain('で使用中')
    expect(EDITOR).toContain('disabled={!canEdit || usedByOthers}')
  })

  it('自分が選んでいる分は外せるように残す', () => {
    expect(EDITOR).toContain('usedBy.length > 0 && !checked')
  })
})
