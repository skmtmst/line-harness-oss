import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
/* 一覧の入口は src/v8/scenarios/list.tsx（2026-10-06〜。古い list-v8.tsx・list-v8.module.css はもう描かれない）。 */
const LIST = readFileSync(join(HERE, '..', '..', 'v8', 'scenarios', 'list.tsx'), 'utf8')
const DETAIL = readFileSync(join(HERE, 'detail', 'detail-v8.tsx'), 'utf8')
const FIRST_CSS = readFileSync(join(HERE, 'first-step-v8.module.css'), 'utf8')

/*
 * V8 シナリオ配信の細かい板（X0QrW0・kz2B6・wjfLe・U5rxyH）。
 * 一覧の閲覧のみは同じ画面の状態として板IDを付け、
 * 編集の競合は帯で知らせて書き換えない。
 * 1152は板1100px未満で畳む（同一画面の幅違い）。v7 は変えない。
 */
describe('シナリオ配信の細かい板', () => {
  it('一覧の閲覧のみに板IDを付ける（X0QrW0）', () => {
    // 新しい一覧は型（ListPage）の boardId で板IDを付ける。
    expect(LIST).toContain("boardId={narrow ? 'wjfLe' : canEdit ? 'axFrW' : 'X0QrW0'}")
  })

  it('一覧1152（wjfLe）は狭い板でフォルダの列を道具の段の選ぶ欄へ畳む', () => {
    // 新しい一覧は CSS の @container ではなく、狭い板の判定（narrow）で畳む。
    expect(LIST).toContain('useNarrowViewport()')
    expect(LIST).toContain('collapsedFolders={narrow ? undefined :')
  })

  it('編集の競合は帯・比べる・読み直しを出す（kz2B6）', () => {
    expect(DETAIL).toContain('data-design-node="kz2B6"')
    expect(DETAIL).toContain('ほかの人がこのシナリオを更新しました')
    expect(DETAIL).toContain('違いを比べる')
    expect(DETAIL).toContain('最新を読み込んで続ける')
    expect(DETAIL).toContain('比べてから保存')
  })

  it('作る②の1152（U5rxyH）は狭い板で右の欄を下へ畳む', () => {
    expect(FIRST_CSS).toContain('@media (max-width: 1352px)')
  })
})
