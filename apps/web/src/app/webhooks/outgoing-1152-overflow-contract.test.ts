import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 外部連携 一覧 1152（AsfFB）の右端越えの見張り。
 * 表は器の幅いっぱい（100%）に固定し、1列目だけ伸び縮み・ほかは固定幅。
 * 固定をやめると 1152幅で表が器より広がる。
 */

const HERE = dirname(fileURLToPath(import.meta.url))

function read(relativePath: string): string {
  return readFileSync(join(HERE, relativePath), 'utf8')
}

describe('外部連携の表は1152幅で器に収まる', () => {
  it('固定幅の表＋1列目だけ自動幅', () => {
    const css = read('../../v8/webhooks/outgoing.module.css')
    const view = read('outgoing-v8.tsx')
    expect(view).toContain('data-table-layout="columns"')
    // 1列目の伸び縮みは共通の表の口（Th/Td の grow）が持つ。画面の CSS では書かない。
    const shared = read('../../components/shared/data-table.module.css')
    expect(shared).toMatch(/\[data-cell-grow\] \{\s*flex: 1 1 0; min-width: 0;/)
    expect(read('../../v8/webhooks/outgoing.tsx')).toMatch(/<Th grow[^>]*className=\{styles\.colName\}/)
    for (const col of ['When', 'Payload', 'Count', 'State', 'Ops']) {
      expect(css).toMatch(new RegExp(`\\.col${col} \\{ width: var\\(--tpl-wh-col-`))
      expect(view).toContain(`styles.col${col}`)
    }
  })
})
