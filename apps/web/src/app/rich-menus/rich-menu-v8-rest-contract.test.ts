import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
/* 一覧の入口は V8 のとき src/v8/rich-menus/list.tsx（2026-10-06〜。古い list-v8.tsx・list-v8.module.css はもう描かれない）。 */
const LIST = readFileSync(join(HERE, '..', '..', 'v8', 'rich-menus', 'list.tsx'), 'utf8')
const CREATE = readFileSync(join(HERE, 'new', 'create-v8.tsx'), 'utf8')
const CREATE_CSS = readFileSync(join(HERE, 'new', 'create-v8.module.css'), 'utf8')

/*
 * V8 リッチメニューの残り（rZEGN・ZoKow・作る①〜④・r8dGXT）。
 * 一覧は板IDを付け（閲覧のみは `ZoKow`）、作る4手順は手順ごとに板IDを付け、
 * 編集中の競合は帯で知らせて書き換えない。v7 は変えない。
 */
describe('リッチメニューの残り板', () => {
  it('一覧は板IDを付ける（閲覧のみは ZoKow）', () => {
    // 新しい一覧は型（ListPage）の boardId で板IDを付ける。1152 は Y9ASp。
    expect(LIST).toContain("boardId={!canEdit ? 'ZoKow' : narrow ? 'Y9ASp' : 'rZEGN'}")
  })

  it('作る4手順は手順ごとに板IDを付ける', () => {
    expect(CREATE).toContain("'JeINq'")
    expect(CREATE).toContain("'Z0uO6'")
    expect(CREATE).toContain("'OxEMM'")
    expect(CREATE).toContain("'F4gELj'")
    expect(CREATE).not.toContain('data-design-node="rich-menu-create-v8"')
  })

  it('編集の競合は帯・比べる・読み直しを出す（r8dGXT）', () => {
    expect(CREATE).toContain('data-design-node="r8dGXT"')
    expect(CREATE).toContain('ほかの人がこのメニューを更新しました')
    expect(CREATE).toContain('違いを比べる')
    expect(CREATE).toContain('最新を読み込んで続ける')
  })

  it('競合は409のときだけ帯にする（入力は残す）', () => {
    expect(CREATE).toContain('e.status === 409')
    expect(CREATE).toContain('setConflict(true)')
  })

  it('1152（Y9ASp・kmTab）は板1100px未満で畳む', () => {
    // 新しい一覧は CSS の @container ではなく狭い板の判定（narrow）で、フォルダの列を道具の段へ畳む。
    expect(LIST).toContain('folders={narrow ? undefined : folderPanel}')
    expect(LIST).toContain('toolbar={narrow ? narrowToolbar : wideToolbar}')
    expect(CREATE_CSS).toContain('@container (max-width: 1100px)')
  })
})
