import { readUiSource } from '../../../scripts/test-ui-source.mjs'
/*
 * #941（N-385〜N-388）の構造契約。
 *
 * 動作テストではなく「この仕掛けがコード上に在るか」を固定する。
 * 消えたら監査指摘の不具合が静かに戻る。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const OVERVIEWS = ['outgoing', 'incoming'].map(name => readUiSource(join(import.meta.dirname, '../../v8/webhooks', `${name}.tsx`), 'utf8')).join('\n')
const INTERACTIONS = readFileSync(join(import.meta.dirname, 'webhook-interactions.tsx'), 'utf8')
const STYLES = readFileSync(join(import.meta.dirname, 'webhook-interactions.module.css'), 'utf8')
const MENU = readFileSync(join(import.meta.dirname, '../../components/shared/action-menu.tsx'), 'utf8')
const API = readFileSync(join(import.meta.dirname, '..', '..', 'lib', 'api.ts'), 'utf8')

describe('N-385: 設定メニューはキーボードだけで開いて選べ、Escape・外側で閉じる', () => {
  it('menu / menuitem の役割と矢印キー移動を持つ', () => {
    expect(OVERVIEWS).toContain('aria-haspopup="menu"')
    expect(MENU).toContain('role="menu"')
    expect(MENU).toContain('role="menuitem"')
    expect(OVERVIEWS).toContain('<ActionMenu')
    expect(MENU).toContain('onKeyDown={moveFocus}')
    expect(MENU).toContain("'ArrowDown'")
    expect(MENU).toContain("'Home'")
    expect(MENU).toContain("'End'")
  })

  it('開いたら最初の項目へフォーカスし、Escape で閉じて「設定」へ戻す', () => {
    expect(MENU).toContain('first.focus({ preventScroll: true })')
    expect(MENU).toContain("event.key === 'Escape'")
    expect(MENU).toContain('anchor.focus({ preventScroll: true })')
    // 外側を押しても閉じる（pointerdown で中か外かを見る）
    expect(MENU).toContain("addEventListener('pointerdown', onPointerDown)")
  })
})

describe('N-386: 狭い幅では重要度の低い列を隠し、情報は詳細で見られる', () => {
  it('1180px以下で「かかった時間」を、760px以下で「送った・届いた中身」を隠す', () => {
    // 見出し・列定義・セルを nth-child で一括に畳む（列のズレ漏れを防ぐ）。
    expect(STYLES).toContain('@media (max-width: 1180px)')
    expect(STYLES).toContain('.table th:nth-child(5)')
    expect(STYLES).toContain('.table td:nth-child(5)')
    expect(STYLES).toContain('.table col:nth-child(5) { display: none; }')
    expect(STYLES).toContain('@media (max-width: 760px)')
    expect(STYLES).toContain('.table th:nth-child(3)')
    expect(STYLES).toContain('.table td:nth-child(3)')
    expect(STYLES).toContain('.table col:nth-child(3) { display: none; }')
  })

  it('隠した値は詳細ダイアログに残る（情報欠落なし）', () => {
    expect(INTERACTIONS).toContain('かかった時間')
    expect(INTERACTIONS).toContain('きっかけ')
  })
})

describe('N-387: まとめて再試行は上限を越えた残りを黙って置き去りにしない', () => {
  it('応答に remaining を受け、残っていれば件数と続きの方法を伝える', () => {
    expect(API).toContain('remaining: number')
    expect(INTERACTIONS).toContain('response.data.remaining')
    expect(INTERACTIONS).toContain('もう一度押すと続きをやり直します')
    // IDEA-26: 結果不明で送らなかった分(needsReview)も残件として成功扱いにしない。
    // 残件あり → 危険の帯に件数と続きの方法。残件なし → Toast（★V7 共通部品その2 §2）。
    expect(INTERACTIONS).toContain('response.data.failed > 0 || response.data.skipped > 0 || response.data.remaining > 0 || response.data.needsReview > 0')
    expect(INTERACTIONS).toContain("setNotice({ tone: 'danger', message: bulkMessage })")
    expect(INTERACTIONS).toContain('notifyToast(bulkMessage)')
  })
})

describe('N-388: 試し送信は送り先を確かめてから送る', () => {
  it('確認ダイアログを挟み、実際のURLを省略せず表示する', () => {
    expect(OVERVIEWS).toContain('ConfirmDialog')
    expect(OVERVIEWS).toContain('setTestTarget(item)')
    expect(OVERVIEWS).toContain('testTarget.url')
    expect(OVERVIEWS).toContain('この送り先へ送る')
    // 「試してみる」ボタンは直接送らず確認へ回す
    expect(OVERVIEWS).not.toContain('onClick={() => void runTest(item)}')
  })
})
