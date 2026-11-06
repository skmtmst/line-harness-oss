import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { readUiSource } from '../../scripts/test-ui-source.mjs'
it("古いV8コピーを指定した試験も実際のページ入口を読む", () => {
  const dir = mkdtempSync(join(tmpdir(), 'bcommon-entry-'))
  try {
    const route = join(dir, 'src/app/tags'), impl = join(dir, 'src/v8/tags')
    mkdirSync(route, { recursive: true }); mkdirSync(impl, { recursive: true })
    writeFileSync(join(route, 'tags-v8.tsx'), '古いコピー')
    writeFileSync(join(route, 'page.tsx'), "export { default } from '@/v8/tags/list'")
    writeFileSync(join(impl, 'list.tsx'), 'いま使う画面')
    const source = readUiSource(join(route, 'tags-v8.tsx'))
    expect(source).toContain('いま使う画面')
    expect(source).not.toContain('古いコピー')
    // 入口がそのファイルを使っている場合には、元の部品を読み続ける。
    writeFileSync(join(route, 'page.tsx'), "export { default } from './tags-v8'")
    expect(readUiSource(join(route, 'tags-v8.tsx'))).toContain('古いコピー')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

it.each([true, false])('入口の相対 import が対象本人かを確認する（%s）', direct => {
  const dir = mkdtempSync(join(tmpdir(), 'entry-direct-'))
  try {
    const route = join(dir, 'src/app/tags'), impl = join(dir, 'src/v8/tags')
    mkdirSync(route, { recursive: true }); mkdirSync(impl, { recursive: true })
    writeFileSync(join(route, 'tags-v8.tsx'), '直接使う画面')
    writeFileSync(join(route, 'other.tsx'), '別の部品')
    writeFileSync(join(impl, 'list.tsx'), '新しい画面')
    writeFileSync(join(route, 'page.tsx'), `import Local from './${direct ? 'tags-v8' : 'other'}'; import Current from '@/v8/tags/list'`)
    const source = readUiSource(join(route, 'tags-v8.tsx'))
    expect(source).toContain(direct ? '直接使う画面' : '新しい画面')
    expect(source).not.toContain(direct ? '新しい画面' : '直接使う画面')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
