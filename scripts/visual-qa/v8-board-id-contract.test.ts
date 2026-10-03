/*
 * V8 の板IDの対応の契約試験（`V8B-MIGRATION-SAFETY.md` §2-1）。
 *
 * V8 の画面の外枠に付ける `data-design-node="<板ID>"` が、対応表
 * （`v8-design-map.json`：BOARD-INDEX＋HANDOVER-MAP＋V8B-HANDOVER-MAP＋specs
 * から作る）・`V8B-HANDOVER-MAP.md`・`specs` の板IDと合っているかを確かめる。
 *
 * - 採用で消えた板ID（対応表の `retired`）が残っていたら落とす。
 * - 対応表に無い ID（V6 時代の名残など）は、積み替えの途中のため落とさず、
 *   件数と一覧を出して人が直す。新しい板が増えたら対応表を作り直す
 *   （`node scripts/visual-qa/build-v8-design-map.mjs`）。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import designMap from './v8-design-map.json'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

type DesignMap = {
  boardCount: number
  retired: string[]
  boards: Record<string, { doc: string; name: string; kind: string | null; route: string | null; width: number | null }>
}

const MAP = designMap as DesignMap
const ADOPTED = new Set(Object.keys(MAP.boards))
const RETIRED = new Set(MAP.retired)

/** 素材の `data-design-node="…"` を全部抜く（ファイルつき）。 */
function usedIds(): Array<{ id: string; file: string }> {
  const files = execFileSync('git', ['grep', '-l', 'data-design-node', '--', 'apps/web/src'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
  const out: Array<{ id: string; file: string }> = []
  for (const file of files) {
    const text = readFileSync(join(ROOT, file), 'utf8')
    for (const match of text.matchAll(/data-design-node="([^"]+)"/g)) {
      out.push({ id: match[1], file })
    }
  }
  return out
}

/** 採用で消えた ID の利用だけを抜く（純粋な判定。合成 data でも試せる）。 */
export function retiredUsages(
  usages: Array<{ id: string; file: string }>,
  retired: Set<string>,
): Array<{ id: string; file: string }> {
  return usages.filter((usage) => retired.has(usage.id))
}

describe('V8 の板IDの対応', () => {
  it('対応表が読めている（0件なら生成器か読み取りが壊れている）', () => {
    expect(MAP.boardCount).toBeGreaterThan(400)
    expect(ADOPTED.size).toBe(MAP.boardCount)
    // BOARD-INDEX で板名が空欄の2枚（表紙系）。増えたら生成器か表の転記を疑う。
    const KNOWN_UNNAMED = new Set(['nUYyb', 'vqu9B'])
    const unnamed = Object.entries(MAP.boards).filter(([, entry]) => entry.name.length === 0)
    expect(unnamed.map(([id]) => id).sort()).toEqual([...KNOWN_UNNAMED].sort())
    for (const [id, entry] of Object.entries(MAP.boards)) {
      expect(entry.doc === 'V8' || entry.doc === 'V8-B', `${id} の文書`).toBe(true)
    }
    expect(Array.isArray(MAP.retired)).toBe(true)
  })

  it('判定そのものが消えたIDを見つけられる', () => {
    const found = retiredUsages(
      [
        { id: 'ywJ5H', file: 'a.tsx' },
        { id: 'DELETED1', file: 'b.tsx' },
      ],
      new Set(['DELETED1']),
    )
    expect(found).toEqual([{ id: 'DELETED1', file: 'b.tsx' }])
  })

  it('採用で消えた板IDを使っていない', () => {
    const usages = usedIds()
    expect(usages.length).toBeGreaterThan(0)
    const retired = retiredUsages(usages, RETIRED)
    expect(
      retired,
      `採用で消えた板IDが残っています。板IDを直すか、対応表の retired を見直してください:\n  ${retired.map((u) => `${u.id}（${u.file}）`).join('\n  ')}`,
    ).toEqual([])
  })

  it('対応表にある板IDを使っている（読み取りの sanity）', () => {
    const usages = usedIds()
    const adopted = usages.filter((usage) => ADOPTED.has(usage.id))
    // 10件未満なら、走査が壊れている（正規表現の変更など）。
    expect(adopted.length).toBeGreaterThan(10)
    const unknown = new Map<string, number>()
    for (const usage of usages) {
      if (!ADOPTED.has(usage.id)) unknown.set(usage.id, (unknown.get(usage.id) ?? 0) + 1)
    }
    if (unknown.size > 0) {
      const top = [...unknown.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
      console.info(
        `[v8-board-id] 対応表に無い data-design-node ${unknown.size} 種（V6時代の名残。積み替え時に板IDへ直す）:\n` +
          top.map(([id, count]) => `  ${id} ×${count}`).join('\n'),
      )
    }
  })

  it('見本の写しが要る板は、対応表から場所が分かる', () => {
    // 撮影道具（v8-parity.mjs）は対応表の route/url を見て開く。
    // 場所なしの板は「まだ積み替え前」として数えるだけ。
    const entries = Object.entries(MAP.boards)
    const withRoute = entries.filter(([, entry]) => entry.route)
    expect(withRoute.length).toBeGreaterThan(300)
    const noRoute = entries.filter(([, entry]) => !entry.route)
    expect(noRoute.length).toBeGreaterThan(0)
  })
})
