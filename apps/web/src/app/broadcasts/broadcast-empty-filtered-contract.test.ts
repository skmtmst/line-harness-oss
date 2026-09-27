import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/**
 * R173: 絞り込み0件をデータ未作成の状態として案内しない。
 *
 * 下書きだけがある状態で「予約中のみ」を押すと、APIは空を返す。
 * 「まだ配信がありません」と出すと保存済みが消えたように見える。
 * 絞りが効いているときの0件は共通 ListState の `filtered`
 * （「条件に合うものがありません」）と「条件をクリア」ボタンにする。
 */
describe('R173 一斉配信の0件の出し分け', () => {
  it('絞りが効いているときの0件は filtered と条件クリアにする', () => {
    expect(PAGE).toContain('broadcastFilterActive')
    expect(PAGE).toContain('emptyPreset="filtered"')
    expect(PAGE).toContain('条件をクリア')
    expect(PAGE).toContain('clearBroadcastFilters')
  })

  it('条件クリアは状態・フォルダ・検索・日付・保存した検索をまとめて戻す', () => {
    expect(PAGE).toContain("setStatusFilter('all')")
    expect(PAGE).toContain("setFolderFilter('')")
    expect(PAGE).toContain("setTitleQuery('')")
    expect(PAGE).toContain("setDateFrom('')")
    expect(PAGE).toContain("setDateTo('')")
    expect(PAGE).toContain("setSavedViewId('')")
  })

  it('何も絞っていない0件は従来どおり「まだ配信がありません」', () => {
    expect(PAGE).toContain('title="まだ配信がありません"')
  })

  it('絞り込み0件では作る口を出さない', () => {
    // 「絞り込みを変えるか、新しく作成してください。」は作る口への誘導だった。
    expect(PAGE).not.toContain('条件に該当する配信はありません')
    expect(PAGE).not.toContain('絞り込みを変えるか、新しく作成してください。')
  })
})
