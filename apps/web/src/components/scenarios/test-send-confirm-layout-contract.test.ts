import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DIALOGS = readFileSync(join(__dirname, 'scenario-dialogs.tsx'), 'utf8')
/** confirming 画面の断片だけを見る（他のダイアログの記述と混ぜない）。 */
const CONFIRMING = DIALOGS.slice(DIALOGS.indexOf('if (confirming)'))

/**
 * Issue #1015 CHK-01（#985 の対応を固定）:
 * シナリオのテスト送信確認を 390px・高さ600px でも開ける形にする。
 *
 * - 左の空き256pxはPCのメニュー（1280px以上）が実在する間だけ。
 * - 上余白265pxは高さのあるPCの値。低い画面では縮めてスクロールさせる。
 * - 確認画面の2列は狭い幅で1列に畳む。
 */
describe('CHK-01 テスト送信確認の狭幅・低画面対応', () => {
  it('左の空きはPCメニューが実在する幅だけ取る', () => {
    expect(CONFIRMING).toContain('xl:left-64')
    // 全幅で256px空ける `left-64` 単独指定へは戻さない。
    expect(CONFIRMING).not.toContain('left-64 z-50')
  })

  it('確認ダイアログの上余白は画面高さに連動し、下までスクロールできる', () => {
    expect(CONFIRMING).toContain("paddingTop: 'min(265px, 30vh)'")
    expect(CONFIRMING).toContain('overflow-y-auto')
    // 固定の265pxへは戻さない。低い画面で「戻る」「開始」が欠ける。
    expect(CONFIRMING).not.toContain("paddingTop: 265")
    expect(CONFIRMING).not.toContain("paddingTop: '265px'")
  })

  it('確認画面の本文は狭い幅で1列に畳む', () => {
    expect(CONFIRMING).toContain('lg:grid-cols-[1.5fr_0.8fr]')
    // 固定の2列比へは戻さない。
    expect(CONFIRMING).not.toContain("gridTemplateColumns: '1.5fr 0.8fr'")
  })

  it('見出し行は狭い幅で折り返せる', () => {
    expect(CONFIRMING).toContain('flex flex-wrap items-center justify-between gap-2')
  })
})
