import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/* 動きの点検（2026-10-07）20 番：主な一覧は 1 行に Tab が 1 回だけ止まる表の本体を使う。 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LISTS = [
  'v8/scenarios/list.tsx',
  'app/reminders/list-v8.tsx',
  'v8/auto-replies/list.tsx',
  'app/tags/tags-tab-v8.tsx',
  'v8/broadcasts/list.tsx',
  'app/templates/list-v8.tsx',
]

describe('主な一覧の行は RovingTbody に入っている', () => {
  it.each(LISTS)('%s', (file) => {
    const source = readFileSync(join(SRC, file), 'utf8')
    expect(source).toContain("from '@/components/shared/row-roving'")
    expect(source).toMatch(/<RovingTbody[\s>][\s\S]*<\/RovingTbody>/)
  })

  it('並び替えのつまみは ↑↓ を一覧の行移動に渡さない', () => {
    const grip = readFileSync(join(SRC, 'components/friend-fields/reorder-grip.tsx'), 'utf8')
    expect(grip).toContain('data-roving-own="vertical"')
  })
})
