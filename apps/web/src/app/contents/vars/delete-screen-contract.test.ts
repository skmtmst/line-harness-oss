import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

/** 共通情報の削除確認（設計 `yPkWe` 14-1-C ／ 契約 #611）。 */
describe('共通情報の削除確認', () => {
  it('窓を開けてから使用先を読む', () => {
    // 一覧を出すたびに全件ぶん読むと、消さない人にも8種類の走査が走る。
    expect(PAGE).toContain('void openSingleDelete(item)')
    expect(PAGE).toContain('api.commonVars.deleteImpact')
  })

  it('使用先が読めないときは消させない', () => {
    // 「参照0件」と読み違えて消すと、差し込んでいた文が空欄のまま送られ続ける。
    expect(PAGE).toContain('使用先を確認できませんでした')
    expect(PAGE).toContain('canDeleteVar({ impact: singleImpact, typedKey, busy: singleBusy })')
  })

  it('差し込みキーを打つまで押し口を出さない', () => {
    /*
     * 空欄のまま送られる場所がある操作を、ボタン1つで通さない。
     * 取り消せないので、対象を取り違えたまま押せる形にしない。
     */
    expect(PAGE).toContain('削除する場合は、差し込みキーを入力してください')
    expect(PAGE).toContain('typedKey, busy: singleBusy }) ? (')
  })

  it('送信済みを消せない理由に混ぜない', () => {
    expect(PAGE).toContain('splitItems(singleImpact.items).blocking')
    expect(PAGE).toContain('splitItems(singleImpact.items).historical')
    expect(PAGE).toContain('これから変わりません')
  })

  it('409 は読み直してから見せる', () => {
    expect(PAGE).toContain('e.status === 409')
    expect(PAGE).toContain('いま使われ始めたため')
  })

  it('遅れて返った別アカウント・別の共通情報・古い世代の結果を映さない', () => {
    expect(PAGE).toContain('singleRequestRef.current.accountId === request.accountId')
    expect(PAGE).toContain('singleRequestRef.current.itemId === request.itemId')
    expect(PAGE).toContain('singleRequestRef.current.generation === request.generation')
    expect(PAGE).toContain('if (!isCurrentRequest()) return')
  })

  it('アカウント切替と窓を閉じる操作で、進行中の単体削除を無効にする', () => {
    expect(PAGE).toContain("setSinglePhase('idle')")
    expect(PAGE).toContain('generation: singleRequestRef.current.generation + 1')
    expect(PAGE).toContain('onCancel={closeSingleDelete}')
  })

  it('いつ時点で確かめたかを書く', () => {
    expect(PAGE).toContain('checkedAtText(singleImpact.checkedAt)')
    expect(PAGE).toContain('8種類を確認しました')
  })

  it('まだ無い操作を押し口にしない', () => {
    // 設計の「別の共通情報に差し替えてから削除する」は口がまだ無い。
    expect(PAGE).toContain('まとめて差し替える操作は、まだ用意していません')
    expect(PAGE).not.toContain('差し替えて削除')
  })

  it('撮影の押し口と面に印を付ける', () => {
    expect(PAGE).toContain('data-qa-open="yPkWe"')
    expect(PAGE).toContain('data-design-node="yPkWe"')
  })
})
