import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/** 名前で見つけた関数の本体だけを切り出す。ファイル全体を見ると素通しになる。 */
function fnBody(src: string, decl: string): string {
  const start = src.indexOf(decl)
  if (start < 0) throw new Error(`${decl} が見つかりません`)
  const open = src.indexOf('{', start)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  throw new Error(`${decl} の本体が閉じていません`)
}

/**
 * リマインダの一括削除（設計 `Y0Sn3` 7-1-I 削除確認）で、
 * **一部だけ失敗したときにやり直せる**こと。
 *
 * 一括削除は途中まで成功することがある。**全部やり直しにすると、成功済みを
 * もう一度消しにいって 404 になり、残りへ永遠に進めない。** 成功した分は
 * 一覧から外し、失敗した分だけ選んだまま窓に残す。
 */
describe('一括削除の一部失敗', () => {
  const body = fnBody(PAGE, 'const handleDeleteSelected = async ()')

  it('失敗したものだけを選び直して、窓を開いたまま残す', () => {
    expect(body, '失敗分だけを選び直していない').toContain('setSelected(new Set(failed))')
    /* 成功したときだけ窓を閉じる。失敗したまま閉じると、やり直す口が消える。 */
    const closeAt = body.indexOf('setConfirmOpen(false)')
    const returnAt = body.indexOf('return')
    expect(closeAt, '窓を閉じていない').toBeGreaterThan(-1)
    expect(closeAt, '失敗しても窓を閉じてしまう').toBeGreaterThan(returnAt)
  })

  it('全部失敗と一部失敗で、違う文を出す', () => {
    /*
     * 「全部だめ」と「3件のうち1件だけだめ」は、次にやることが違う。
     * 同じ文だと、何件残っているのか画面から読めない。
     */
    expect(body).toContain('failed.length === targets.length')
    expect(body).toContain('選択したリマインダを削除できませんでした。')
    expect(body).toContain('件のリマインダを削除できませんでした。削除できなかったものだけを残しています。')
  })

  it('失敗しても一覧を読み直す', () => {
    /* 成功した分は消えている。読み直さないと、消えた行が残って見える。 */
    const failBranch = body.slice(body.indexOf('if (failed.length > 0)'))
    const earlyReturn = failBranch.indexOf('return')
    expect(earlyReturn, '失敗の枝が見つからない').toBeGreaterThan(-1)
    expect(
      failBranch.slice(0, earlyReturn),
      '失敗の枝で一覧を読み直していない',
    ).toContain('await loadReminders()')
  })

  it('口の返事をそのまま画面へ出さない', () => {
    /*
     * `API error: 405` のような内部の言葉が窓に出ていた。出す文は
     * この画面で組み立てたものだけにする。
     */
    expect(body, '口の返事を素通ししている').not.toMatch(/res\.error/)
    expect(body).not.toMatch(/setDeleteError\([^)]*\b(err|error|e)\b[^)]*\)/)
    expect(body).not.toMatch(/setDeleteError\([^)]*String\(/)
  })

  it('押している間は受け付けない', () => {
    /* 二度押しの2回目は404になり、消えているのに「削除できませんでした」と出る。 */
    expect(body).toContain('if (selected.size === 0 || deleting) return')
  })
})
