/*
 * 画面の module.css の「余白・高さ・文字の大きさ」が増えていないための試験。
 *
 * 一覧の型の寸法は型の CSS の変数（--tpl-*）に1か所まとめている。
 * 画面側で余白・高さ・文字の大きさを直書きすると、絵を変えるたびに
 * 画面ごとの書き換えが要る。`direct-values.test.ts` と同じ形で、
 * ファイルごとの数（余白・高さ・文字）が基準より増えたら落ちる。
 * 基準に無いファイルに1か所でもあれば落ちる。
 *
 * 意図して増やす場合の基準更新:
 *
 *     node apps/web/scripts/screen-css-budget.mjs
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { countScreenCss, screenFiles, BASELINE } from '../../scripts/screen-css-budget.mjs'

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<
  string,
  { spacing: number; height: number; font: number }
>

describe('画面の余白・高さ・文字（型の変数を使う）', () => {
  const now = countScreenCss()

  it('増えていない', () => {
    const worse: Record<string, string> = {}
    for (const [file, entry] of Object.entries(now)) {
      const was = baseline[file] ?? { spacing: 0, height: 0, font: 0 }
      for (const kind of ['spacing', 'height', 'font'] as const) {
        if (entry[kind] > was[kind]) {
          worse[`${file} (${kind})`] = `${was[kind]} → ${entry[kind]}`
        }
      }
    }
    // 落ちたら: 型の変数（--tpl-*）に寄せるか、意図があるなら
    // node apps/web/scripts/screen-css-budget.mjs で基準を更新してください。
    expect(worse).toEqual({})
  })

  // 監査 ROOT-23：V8 の画面（src/v8）の CSS も数える。app だけだと V8 へ移した画面が見張りから外れる。
  it('V8 の画面（src/v8）の CSS も数える', () => {
    expect(screenFiles().some((file: string) => /[\\/]src[\\/]v8[\\/]/.test(file))).toBe(true)
    expect(Object.keys(baseline).some((file) => file.startsWith('v8/'))).toBe(true)
  })
})
