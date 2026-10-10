import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { readUiSource } from '../../scripts/test-ui-source.mjs'
it('B-40: 古いV8コピーを指定した試験も実際のページ入口を読む', () => {
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
