import { readApiSource } from '../../../scripts/test-api-source.mjs'
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
const INTERACTIONS = readFileSync(join(import.meta.dirname, '../../v8/webhooks/interactions.tsx'), 'utf8')
const STYLES = readFileSync(join(import.meta.dirname, '../../v8/webhooks/interactions.module.css'), 'utf8')
const ROW_MENU = readFileSync(join(import.meta.dirname, '../../components/shared/row-actions.tsx'), 'utf8')
const MENU = readFileSync(join(import.meta.dirname, '../../components/shared/action-menu.tsx'), 'utf8')
const API = readApiSource(join(import.meta.dirname, '..', '..', 'lib', 'api.ts'), 'utf8')

describe('N-385: 設定メニューはキーボードだけで開いて選べ、Escape・外側で閉じる', () => {
  it('menu / menuitem の役割と矢印キー移動を持つ', () => {
    expect(MENU).toContain('role="menu"')
    expect(MENU).toContain('role="menuitem"')
    expect(OVERVIEWS).toContain('<RowMenu')
    expect(ROW_MENU).toContain('<ActionMenu')
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
  it('V8では名前列を伸ばし、短い文字列は1行で省略する', () => {
    // 管理画面の1180px分岐を持ち込まず、1152のV8でも採用済みの列を保つ。
    expect(INTERACTIONS).toContain('<Th grow className={styles.colName}>')
    expect(INTERACTIONS).toContain('<Td grow className={styles.colName}>')
    expect(STYLES).toContain('min-width: 0;')
    expect(STYLES).toContain('text-overflow: ellipsis;')
    expect(STYLES).toContain('white-space: nowrap;')
    expect(INTERACTIONS).toContain('title={item.triggerSummary}')
  })

  it('隠した値は詳細ダイアログに残る（情報欠落なし）', () => {
    expect(INTERACTIONS).toContain('かかった時間')
    expect(INTERACTIONS).toContain('きっかけ')
  })
})

describe('N-387: まとめて再試行は上限を越えた残りを黙って置き去りにしない', () => {
  it('応答に remaining を受け、残っていれば件数と続きの方法を伝える', () => {
    expect(API).toContain('remaining: number')
    expect(INTERACTIONS).toContain('d.remaining')
    expect(INTERACTIONS).toContain('もう一度押すと続きをやり直します')
    // IDEA-26: 結果不明で送らなかった分(needsReview)も残件として成功扱いにしない。
    // 残件あり → 危険の帯に件数と続きの方法。残件なし → Toast（★管理画面 共通部品その2 §2）。
    expect(INTERACTIONS).toContain('d.failed > 0 || d.skipped > 0 || d.remaining > 0 || d.needsReview > 0')
    expect(INTERACTIONS).toContain('setNotice(message)')
    expect(INTERACTIONS).toContain('notifyToast(message)')
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
