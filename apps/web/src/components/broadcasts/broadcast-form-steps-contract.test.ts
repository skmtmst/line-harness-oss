import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * 作成画面が設計 `LMiL2` の5段の帯を持ち、その帯が実際に節へ飛べることを見る。
 *
 * **ファイル全体を toContain で見ない。** 1,200行あるので、どこか1か所に
 * 同じ語があるだけで通ってしまう。段の計算式・帯の描画・節の id を
 * それぞれ切り出して見る。
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const FORM = readFileSync(join(HERE, 'broadcast-form.tsx'), 'utf8')
const STEPS = readFileSync(join(HERE, 'broadcast-steps.ts'), 'utf8')

/** `start` から、対応する `)` までを切り出す。 */
function callArguments(source: string, start: string): string {
  const from = source.indexOf(start)
  expect(from, `${start} が見つかりません`).toBeGreaterThan(-1)
  let depth = 0
  for (let i = from + start.length - 1; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1
    else if (source[i] === ')') {
      depth -= 1
      if (depth === 0) return source.slice(from, i + 1)
    }
  }
  throw new Error(`${start} の終わりが見つかりません`)
}

/**
 * JSX のコメントを落とす。
 *
 * 「この語を出さない」を見るときにコメントごと数えると、**なぜ出さないかを
 * 書いた注記そのものに引っかかる**。画面に出る文だけを見る。
 */
function withoutComments(source: string): string {
  return source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
}

const STEP_CALL = callArguments(FORM, 'const steps = broadcastSteps(')

describe('作成画面の5段の帯（設計 LMiL2）', () => {
  it('帯を描いている', () => {
    expect(FORM).toContain('<BroadcastStepRail steps={steps} />')
  })

  /**
   * 帯の判定と保存の検査が同じ関数を通ること。
   *
   * 別々に書くと、帯は「メッセージ 済み」なのに保存で断られる、という
   * 一番困る形になる。段の計算式の中だけを見る。
   */
  it('段の判定は保存の検査と同じ関数を通す', () => {
    expect(STEP_CALL).toContain('bubblesError(bubbles)')
    expect(STEP_CALL).toContain('audienceError(targetMode')
  })

  it('送信設定は「今すぐ」か、日付と時刻がそろって初めて済みになる', () => {
    expect(STEP_CALL).toContain("sendMode === 'now'")
    expect(STEP_CALL).toContain('Boolean(scheduledDate)')
    expect(STEP_CALL).toContain('Boolean(scheduledTime)')
  })

  /**
   * 段の飛び先が実在すること。
   *
   * 押しても何も起きない帯は、設計の絵だけ写して機能が無い状態。
   * `broadcast-steps.ts` に書いた id が、作成画面の節に付いているかを見る。
   */
  it('段の飛び先の id が、作成画面の節に付いている', () => {
    const anchors = [...STEPS.matchAll(/anchor: '([^']+)'/g)].map((m) => m[1])
    expect(anchors.length).toBe(5)
    for (const anchor of anchors) {
      expect(FORM, `${anchor} を持つ節がありません`).toContain(`id="${anchor}"`)
    }
  })
})

describe('配信名の字数（設計 zZ9fA）', () => {
  it('入力欄のそばに「n / 60文字」を出す', () => {
    const label = FORM.slice(
      FORM.indexOf('<span className="text-ink text-sm font-bold">管理用タイトル</span>'),
      FORM.indexOf('placeholder="例：8月キャンペーンのお知らせ"'),
    )
    expect(label).toContain('{title.trim().length} / {TITLE_MAX}文字')
  })

  /** 数えるだけで止めないと、上限を超えたまま保存できてしまう。 */
  it('上限を超えたら保存の検査で止める', () => {
    const validate = FORM.slice(
      FORM.indexOf('const validate = () => {'),
      FORM.indexOf('/**\n   * 配信前チェック。'),
    )
    expect(validate).toContain('title.trim().length > TITLE_MAX')
  })
})

describe('本文の節の番号', () => {
  /**
   * **本文の番号が、画面に並ぶ順と合っていること。**
   *
   * 以前は 1・3・2 と振ってあり、画面には「1. 送る相手 → 3. 送る内容 →
   * 2. 送る時間」の順に出ていた。**番号が飛んで見えるので、間の節を
   * 見落としたと読まれる。** 設計 `zZ9fA` の段は
   * 基本設定 → 対象者 → メッセージ → 送信設定 → 確認 の5つ。
   */
  it('番号は、画面に並ぶ順と同じ', () => {
    const headings = [...FORM.matchAll(/font-bold[^>]*>(\d)\.\s*([^<]+)</g)].map((m) => [Number(m[1]), m[2].trim()] as const)
    expect(headings.length, '番号つきの節が見つからない').toBeGreaterThanOrEqual(3)
    // 出てくる順に、番号が増えていく
    const numbers = headings.map(([n]) => n)
    expect(numbers, `番号が並び順と合っていない: ${JSON.stringify(headings)}`).toEqual([...numbers].sort((a, b) => a - b))
    // 上の段（STEP 1〜5）と同じ番号を使う。基本設定が 1、確認が 5。
    expect(headings).toEqual([[2, '送る相手'], [3, '送る内容'], [4, '送る時間']])
  })
})

describe('予約の注意書き（設計 Bw0zt）', () => {
  /**
   * 予約は条件を保存するだけで、宛先は予約の時刻に決まる。
   * いまの人数のまま固定されると思われると、増減したときに数が合わなく見える。
   */
  it('日時を指定したときだけ、送信直前に数え直すことを書く', () => {
    const start = FORM.indexOf("{sendMode === 'scheduled' && (")
    expect(start).toBeGreaterThan(-1)
    const scheduled = withoutComments(FORM.slice(start, FORM.indexOf('htmlFor="bc-spread"', start)))
    expect(scheduled).toContain('id="bc-time"')
    expect(scheduled).toContain('もう一度対象を数え直してから送ります')
    // 数え直すことだけ書いて、増減しうると書かないと「同じ人数が届く」と読まれる。
    expect(scheduled).toContain('いま出ている人数から増減することがあります')
    // 送信枠を読む口がこの画面には無い。出せない数を約束しない。
    expect(scheduled).not.toContain('送信枠')
  })
})
