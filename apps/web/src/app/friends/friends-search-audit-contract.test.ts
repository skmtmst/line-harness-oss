import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * #1010 友だちの検索条件・保存検索・集計の監査修正を画面契約として固定する。
 * 対象ID: FRIEND-01/02/03/04/05/08/18/19/20/29/30/32, A03-02
 * （A03-01・U018 は既存の対策を再確認。FRIEND-06/07 は行部品側。）
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const DIALOG = readFileSync(join(HERE, '..', '..', 'components', 'friends', 'advanced-search-dialog.tsx'), 'utf8')
const SAVED = readFileSync(join(HERE, '..', '..', 'components', 'friends', 'saved-search-dialog.tsx'), 'utf8')
const KPIS = readFileSync(join(HERE, '..', '..', 'components', 'friends', 'friend-kpis.tsx'), 'utf8')
const ROW = readFileSync(join(HERE, '..', '..', 'components', 'friends', 'friend-list-row.tsx'), 'utf8')
const UTILS = readFileSync(join(HERE, '..', '..', 'components', 'friends', 'saved-search-utils.ts'), 'utf8')

describe('FRIEND-01 対象の選択を1か所の明示的な4値にする', () => {
  it('表示中/非表示のみ/ブロックした人/すべてのラジオを1グループで出す', () => {
    expect(UTILS).toContain("export type FriendVisibilityChoice = 'visible' | 'hidden' | 'blocked' | 'all'")
    expect(DIALOG).toContain('role="radiogroup"')
    for (const label of ['表示中', '非表示のみ', 'ブロックした人', 'すべて']) {
      expect(DIALOG).toContain(`label: '${label}'`)
    }
    // 空文字を「非表示」と「すべて」の両方に使う二重管理はしない。
    expect(DIALOG).not.toContain("setVisibility(''")
    expect(UTILS).toContain("'visible_only'")
    expect(UTILS).toContain("'hidden_only'")
  })

  it('リセットは初期の「表示中」へ戻す', () => {
    expect(DIALOG).toContain("setVisibility('visible')")
  })

  it('「すべて」で条件が無いときは空の conditions を送らない（受け口の弾きで422にならない）', () => {
    expect(DIALOG).toContain('hasSavedSearchFilter(conditions)')
    expect(UTILS).toContain('export function hasSavedSearchFilter')
  })
})

describe('FRIEND-02 同じ項目の条件をすべて残す', () => {
  it('ブロック配列から conditions.all へ変換し、平たい引数へ上書きで潰さない', () => {
    expect(UTILS).toContain('export function editorStateToConditions')
    expect(UTILS).toContain('export function blockToConditions')
    expect(DIALOG).toContain('editorStateToConditions(editorState')
  })
})

describe('FRIEND-04/32 適用した条件を一覧と編集画面で一致させる', () => {
  it('詳細条件の適用で一覧の並び順・表示件数も更新する', () => {
    const apply = PAGE.match(/onApply=\{\(result\) => \{[\s\S]*?\}\}/)
    expect(apply).not.toBeNull()
    expect(apply![0]).toContain('setSortMode(result.params.sort)')
    expect(apply![0]).toContain('setPageSize')
  })

  it('詳細条件を開くと適用中の編集状態と現在の並び順・件数から再開する', () => {
    expect(PAGE).toContain('applied={advanced}')
    expect(PAGE).toContain('initialSort={sortMode}')
    expect(PAGE).toContain('initialLimit={pageSize}')
    expect(DIALOG).toContain('applied?.editorState')
  })

  it('保存した検索は実条件を編集状態へ復元して渡す', () => {
    expect(SAVED).toContain('editorState: conditionsToEditorState(search.conditions)')
    expect(UTILS).toContain('export function conditionsToEditorState')
    // 編集画面で組み直せない条件も黙って落とさない。
    expect(UTILS).toContain('extraAll')
  })

  it('無変更の再適用は savedSearchId を残す（条件との同時送信は受け口が拒否）', () => {
    expect(DIALOG).toContain('applied?.params.savedSearchId')
    expect(DIALOG).toContain('savedSearchId: appliedSavedId')
    expect(DIALOG).toContain('JSON.stringify(applied.editorState)')
  })

  it('詳細条件の表示件数は制御された値として params.limit へ入る', () => {
    expect(DIALOG).toContain('const [limit, setLimit] = useState<number>')
    expect(DIALOG).toContain('{ sort, limit }')
  })
})

describe('FRIEND-05 対応状況は固定4状態', () => {
  it('保留を選べる', () => {
    expect(DIALOG).toContain('<option value="on_hold">保留</option>')
  })
})

describe('A03-02 件数の古い応答と失敗を扱う', () => {
  it('要求の世代を照合し、失敗は再試行を出す', () => {
    expect(DIALOG).toContain('const countRequestRef = useRef(0)')
    expect(DIALOG).toContain('requestId !== countRequestRef.current')
    expect(DIALOG).toContain('setCountFailed(true)')
    expect(DIALOG).toContain('件数を確認できません')
    expect(DIALOG).toContain('再試行')
  })
})

describe('FRIEND-08 集計はアカウントごとの値だけを出す', () => {
  it('取り直す前に前の人数を消し、失敗と再試行を表示する', () => {
    expect(KPIS).toContain('setStats(null)')
    expect(KPIS).toContain('const requestRef = useRef(0)')
    expect(KPIS).toContain('requestRef.current === requestId')
    expect(KPIS).toContain('友だち集計を読み込めませんでした')
    expect(KPIS).toContain('再読み込み')
  })
})

describe('FRIEND-18/19/20/29/30 保存した検索の窓', () => {
  it('FRIEND-18: 失敗・空・成功を排他的にし、失敗には再読込を置く', () => {
    expect(SAVED).toContain('保存した検索を読み込めませんでした')
    expect(SAVED).toContain('再読み込み')
    expect(SAVED).toContain('!loading && !error && saved.length === 0')
  })

  it('FRIEND-19: 切替・再読込のたびに前の候補を破棄する', () => {
    const effect = SAVED.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[accountId, reloadKey\]\)/)
    expect(effect).not.toBeNull()
    expect(effect![0]).toContain('setSaved([])')
    expect(effect![0]).toContain('cancelled')
  })

  it('FRIEND-20: 対象と全条件を適用前に読める', () => {
    expect(SAVED).toContain('describeSavedVisibility(search.conditions)')
    expect(SAVED).toContain('ほか')
    expect(SAVED).toContain('の条件を表示')
  })

  it('FRIEND-29: 長い名前は折り返し、共有範囲のバッジは縮めない', () => {
    expect(SAVED).toContain('line-clamp-2')
    expect(SAVED).toContain('wrap-anywhere')
    expect(SAVED).toContain('title={search.name}')
    expect(SAVED).toContain('shrink-0 rounded-pill')
  })

  it('FRIEND-30: パネル全体を画面内に収め、内容だけ伸縮する', () => {
    expect(SAVED).toContain('max-h-full')
    expect(SAVED).toContain('flex-col')
    expect(SAVED).toContain('overflow-y-auto')
  })
})

describe('FRIEND-06/07 一覧行の対応状況と最終接触', () => {
  it('on_hold は「保留」、最終接触は送受信の新しい方', () => {
    expect(ROW).toContain("status === 'on_hold'")
    expect(ROW).toContain("label: '保留'")
    expect(ROW).toContain('latestOutgoingAt')
    expect(ROW).toContain('incomingAt')
  })
})
