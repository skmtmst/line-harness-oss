/*
 * 「直接の値」（色コード・px の丸み・影の直書き）を、**これ以上増やさない**
 * ための試験。★V7「見た目の物差し」§1 の決まりを design-lint に足したもの。
 *
 *   決まり: 部品の CSS・className の両方で、色コード・px の丸み・影は
 *           直書き禁止（トークンだけ）。既存の分は近いトークンへの
 *           対応表を作ってから一括で直す（作業の分け方の 3 番）。
 *
 * 既存の生の色の試験（raw-colors.test.ts）は Tailwind の色名だけを見て
 * いるので、`bg-[#06c755]` や CSS Modules の `border-radius: 8px` は
 * 素通りする。ここは値そのものを数える。
 *
 *   - ファイルごとの数（色・丸み・影それぞれ）が基準より増えたら落ちる
 *   - 基準に無いファイルに1か所でもあれば落ちる
 *
 * 意図して増やす場合の基準更新:
 *
 *     node apps/web/scripts/direct-values-baseline.mjs
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { countDirectValues, BASELINE, SRC } from '../../scripts/direct-values-baseline.mjs'

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<
  string,
  { color: number; radius: number; shadow: number }
>

describe('直接の値（色コード・px の丸み・影）', () => {
  const now = countDirectValues()

  it('増えていない', () => {
    const worse: Record<string, string> = {}
    for (const [file, entry] of Object.entries(now)) {
      const was = baseline[file] ?? { color: 0, radius: 0, shadow: 0 }
      // 集計スクリプトはinline styleの引用符を直書きとして数える。
      // CSS変数を参照するborderRadiusはトークンなので、増加に含めない。
      const source = readFileSync(join(SRC, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/[^\n]*/g, '')
      const tokenRadii = source.match(/\bborderRadius\s*:\s*(['"])var\(--radius-[\w-]+\)\1/g)?.length ?? 0
      const direct = { ...entry, radius: entry.radius - tokenRadii }
      for (const kind of ['color', 'radius', 'shadow'] as const) {
        if (direct[kind] > was[kind]) {
          worse[`${file} (${kind})`] = `${was[kind]} → ${direct[kind]}`
        }
      }
    }
    // 落ちたら: トークン（--color-* / --radius-* / --shadow-*）に直すか、
    // 意図があるなら node apps/web/scripts/direct-values-baseline.mjs で
    // 基準を更新してください。
    expect(worse).toEqual({})
  })
})
