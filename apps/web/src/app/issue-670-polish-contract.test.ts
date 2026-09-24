import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * Issue #670（画面別の磨き上げ13件）の構造契約。
 * 見た目の最終確認は実画面で行うため、ここでは「監査で指摘された形が
 * 戻らないこと」をソースの形で固定する。
 *
 * 監査所見（Devin判定_第6パス A8〜A13）のうち、本Issueで直した分：
 *  - A8  10ウェビナー: 1行の表でも約350pxの空領域＋件数が枠外に孤立
 *  - A9  20分析: 「初回更新を待っています」が帯とグラフ枠で二重表示
 *  - A12 28予約設定: ⠿ の持ち手がドラッグ不可の飾りだった
 *  - A13 24 LINE通知: カード4枚＋3枚の非対称グリッド
 *  - A13 25 オートメーション: 状態が素テキスト（他画面は印）
 *  - A13 08 自動応答: 凡例の消し線だけの印が「デ」に見えた＋帯2段
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(join(HERE, path), 'utf8')

describe('A8: ウェビナー一覧の器は中身の高さに合わせる', () => {
  const page = read('webinars/page.tsx')

  it('一覧の器に固定の最小高さを持たせない', () => {
    expect(page).not.toContain('min-h-[360px]')
  })
})

describe('A9: 分析の集計待ちは帯1本だけが理由を言う', () => {
  const page = read('analytics/page.tsx')

  it('グラフ枠は理由文（stateReason）を繰り返さない', () => {
    /*
     * 警告帯が stateReason を出し、グラフ枠の待ち表示でも同じ文が
     * 出ていた。枠内は短い状態＋次にすることだけに絞る。
     */
    const placeholder = page.slice(page.indexOf('{!daysShown ? ('), page.indexOf(') : ('))
    expect(placeholder).not.toContain('pendingReason')
    expect(placeholder).not.toContain('stateReason')
  })

  it('集計待ちの案内（更新周期と戻り方）は残す', () => {
    expect(page).toContain('日ごとの集計は数分ごとに自動で更新されます')
  })
})

describe('A12: 予約メニューに押せないドラッグ持ち手を置かない', () => {
  const page = read('booking/menus/page.tsx')

  it('⠿ の飾りを行頭に出さない', () => {
    expect(page).not.toContain('⠿')
  })

  it('並び順を変える実際の経路（編集内の数値欄）は残る', () => {
    expect(page).toContain("label=\"並び順\"")
  })
})

describe('A13(24): LINE通知の帯はまとまりごとに段を分ける', () => {
  const page = read('line-notifications/page.tsx')
  const kpis = read('line-notifications/customer-kpis.ts')

  it('お知らせの数と月の送信枠を別の段に分ける', () => {
    expect(page).toContain("kpi.group === 'notice'")
    expect(page).toContain("kpi.group === 'quota'")
    expect(kpis).toContain("group: 'notice'")
    expect(kpis).toContain("group: 'quota'")
  })

  it('送信枠の3枚は3列で並ぶ', () => {
    expect(page).toContain('sm:grid-cols-3')
  })
})

describe('A13(25): オートメーションの状態は印（チップ）で示す', () => {
  const page = read('automations/page.tsx')

  it('状態を素テキストではなく Chip で出す', () => {
    expect(page).toContain("import Chip from '@/components/shared/chip'")
    expect(page).toContain("<Chip tone={automation.isActive ? 'ok' : 'neutral'}>")
  })
})

describe('A13(08): 自動応答の案内は1本の帯に、無効の印は明示する', () => {
  const page = read('auto-replies/page.tsx')
  const words = read('auto-replies/auto-reply-words.ts')

  it('動かないアカウントの札は消し線だけでなく印を付ける', () => {
    expect(words).toContain("mark: '✕'")
    expect(page).toContain('{word.mark} {label}')
  })

  it('案内と凡例は別々の帯ではなく1本にまとめる', () => {
    /*
     * 帯2段の連続で一覧が下へ押しやられていた。統合後は
     * 「最初に当てはまった1つだけ」の段落と凡例が同じ帯の中にある。
     */
    const banner = page.slice(page.indexOf('最初に当てはまった'), page.indexOf('data-design="Bar"'))
    expect(banner).toContain('EFFECTIVE_LEGEND.map')
  })
})
