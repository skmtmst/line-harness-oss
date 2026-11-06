import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const CSS = readFileSync(join(HERE, '../../components/templates/page-templates.module.css'), 'utf8')

/*
 * V8 設定の残り。
 * 機能設定・マニュアルの正本表・ファイルの検査の読み込み中・読めなかった・0件・「条件を外す」と、
 * はじめの設定の板の印と順路の表は描画の試験が確かめる（v8/settings/features/screen.test.tsx・
 * manual-links/screen.test.tsx・getting-started/getting-started.test.tsx、app/settings/file-scan/file-scan-page.test.tsx）。
 * 残るのは型の CSS の幅の折りたたみ（描画の試験で見えない）。
 */
describe('設定の残り板', () => {
  it('1152（bKipf）は板1100px未満で1列に畳む', () => {
    expect(CSS).toContain('@container v8-page (max-width: 1099px)')
    expect(CSS).toContain('.folders { display: none; }')
  })
})
