/*
 * Issue #968 のうち詳細画面・一覧画面側の契約試験。
 *
 * - U007: 同時購読のラベルと説明を一致させる。
 * - U027: シナリオ一覧のフォルダ領域をスマホで折り畳む。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const DETAIL = readFileSync(join(HERE, 'scenario-detail-client.tsx'), 'utf8')
const LIST = readFileSync(join(HERE, '..', 'page.tsx'), 'utf8')

describe('U007: 同時購読のラベルと説明を一致させる', () => {
  it('許可中・不許可で説明を切り替える。固定の説明ではない', () => {
    // 許可中の説明
    expect(DETAIL).toContain('いまは同時購読を許しています')
    expect(DETAIL).toContain('このシナリオに入らなくなります')
    // 不許可の説明
    expect(DETAIL).toContain('いまは同時に1つだけです')
    expect(DETAIL).toContain('押すと同時購読を許すようになります')
    // 以前の「許可中でも停止する」とだけ書く固定文は残さない。
    expect(DETAIL).not.toContain(
      'title="別のシナリオを開始すると、いま流れているシナリオは停止します',
    )
  })

  it('説明は実挙動（他のシナリオが動いている人は登録しない）と同じ意味', () => {
    // 編集フォーム側の既存の説明と同じ実挙動を、カードのヘルプでも書く。
    expect(DETAIL).toContain('他のシナリオが動いている人は登録しない')
    expect(DETAIL).toContain('他のシナリオが動いている人はこのシナリオに入りません')
    // 実挙動を変える切替は今までどおり allowConcurrent の更新だけ。
    expect(DETAIL).toContain('api.scenarios.update(id, { allowConcurrent: allow })')
  })
})

describe('U027: シナリオ一覧のフォルダ領域を折り畳む', () => {
  it('スマホでは畳んだ帯から開き、PCでは左の帯のまま', () => {
    // 畳む側: <details> がスマホだけ出る。
    expect(LIST).toMatch(/<details className="[^"]*lg:hidden/)
    // 畳んだ帯には今の選択が読める。
    expect(LIST).toContain('フォルダ：{activeFolderLabel}')
    // PC側は非表示クラス付きの帯で、フォルダの中身は1つの要素を使い回す。
    expect(LIST).toContain('hidden lg:block')
    expect(LIST.match(/\{folderPanel\}/g)?.length).toBe(2)
  })

  it('選択肢の行は増えても帯の外は1行。長い名前は FolderPanel 側で省略される', () => {
    // 帯の見出しは選択名だけを出し、一覧を抱え込まない。
    expect(LIST).toContain('タップで開く')
    // 絞り込みの選択は今までどおり FolderPanel の行で行う。
    expect(LIST).toContain('onSelect={setFolderFilter}')
    expect(LIST).toContain("id: UNFILED")
  })
})
