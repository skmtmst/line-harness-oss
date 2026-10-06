import { readFileSync } from 'node:fs'
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
    const css = read('outgoing-v8.module.css')
    expect(css).toContain('table-layout: fixed')
    const view = read('outgoing-v8.tsx')
    expect(view).toContain('<colgroup>')
    // 1列目（つなぎ先）は幅を指定しない。ほかは中身幅で固定する。
    for (const width of ['7rem', '10rem', '6rem', '10rem', '12rem']) {
      expect(view).toContain(`width: '${width}'`)
    }
  })
})
