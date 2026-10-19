/*
 * Issue #968 のうち詳細画面・一覧画面側の契約試験。
 *
 * - U007: 同時購読のラベルと説明を一致させる。
 * - U027: シナリオ一覧のフォルダ領域をスマホで折り畳む。
 */
import { readUiSource as readFileSync } from '../../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const DETAIL = readFileSync(join(HERE, 'scenario-detail-client.tsx'), 'utf8')
/* 完全切り替え：管理画面 の一覧 page.tsx は捨て、V8 を見る。入口は src/v8/scenarios/list.tsx（古い list-v8.tsx はもう描かれない）。 */
const LIST = readFileSync(join(HERE, '..', '..', '..', 'v8', 'scenarios', 'list.tsx'), 'utf8')

describe('U007: 同時購読のラベルと説明を一致させる', () => {
  it('許可中・不許可で見出しの状態を変え、編集窓は同じ値を使う', () => {
    expect(DETAIL).toContain("'同時購読を許可中' : '同時に1つだけ'")
    expect(DETAIL).toContain('checked={editForm.allowConcurrent}')
    expect(DETAIL).toContain('allowConcurrent: scenario.allowConcurrent !== false')
  })

  it('許可の意味を説明し、保存した値をAPIへ渡す', () => {
    expect(DETAIL).toContain('同時購読を許可する（ほかのシナリオが動いている人にも並行して流す）')
    expect(DETAIL).toContain('allowConcurrent: editForm.allowConcurrent')
    expect(DETAIL).toContain('await api.scenarios.update(id, {')
  })
})

describe('U027: シナリオ一覧のフォルダ領域を折り畳む', () => {
  it('狭い板では左の列を道具の段の選ぶ欄へ畳む', () => {
    // 板 ：フォルダの列は道具の段の「フォルダ：すべて」へ畳まれる。
    // ：作成とフォルダの口を型へ渡す。
    expect(LIST).toContain('collapsedFolders={<>{createButton(false)}{folderSelect}</>}')
    expect(LIST).toMatch(/<Select\b[^>]*aria-label="フォルダ"[^>]*value=\{folderFilter\}[^>]*onChange=\{setFolderFilter\}/)
    expect(LIST).toContain('フォルダ：すべて')
    expect(LIST).toContain('aria-label="フォルダ"')
  })

  it('選択肢の行は増えても帯の外は1行。長い名前は FolderPanel 側で省略される', () => {
    // 絞り込みの選択は今までどおり FolderPanel（共通の ManagedFolderPanel）の行で行う。
    expect(LIST).toContain('onSelect={setFolderFilter}')
    expect(LIST).toContain('unfiledId={UNFILED}')
  })
})
