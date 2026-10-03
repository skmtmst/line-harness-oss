import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const MODAL = readFileSync(join(HERE, '_components', 'edit-route-modal.tsx'), 'utf8')

/*
 * 流入リンク編集窓の同時編集（板 E14GFm）。
 *
 * 編集の PATCH は開いたときの更新日時を送る。ほかの人が先に保存して
 * 409 になったら上書きせず、帯で今の中身を見せる。帯から違いを比べ、
 * 最新を取り込んで直せる。作る側（POST）は日時を送らない。
 */
describe('リファラルリンク編集窓の同時編集 (E14GFm)', () => {
  it('編集の保存は開いたときの更新日時を付けて送る', () => {
    // 基準は開いた行の更新日時。保存が通ったら進んだ値に寄せる。
    expect(MODAL).toContain('useState<string | null>(route?.updatedAt ?? null)')
    expect(MODAL).toContain('expectedUpdatedAt: baseline ?? undefined')
    expect(MODAL).toContain('setBaseline(res.data.updatedAt)')
  })

  it('409なら帯を出して上書きせず、比べと取り込みに寄せる', () => {
    // 409 の今の中身だけ拾う。形が違えば従来の失敗扱い。
    expect(MODAL).toContain('readConflictLatest(err)')
    expect(MODAL).toContain('setConflictLatest(latest)')
    // 帯（板の文面）。上書きの操作は置かない。
    expect(MODAL).toContain('data-design-part="edit-conflict-band"')
    expect(MODAL).toContain('このまま保存すると、その人の変更が消えます')
    expect(MODAL).toContain('違いを比べる')
    expect(MODAL).toContain('最新を取り込んで直す')
    expect(MODAL).not.toContain('上書き保存')
    expect(MODAL).not.toContain('強制保存')
  })

  it('比べは違う項目だけを下書きと今の保存内容で並べる', () => {
    expect(MODAL).toContain('RouteConflictCompare')
    expect(MODAL).toContain('data-design-part="edit-conflict-compare"')
    expect(MODAL).toContain('自分の変更（下書き）')
    expect(MODAL).toContain('今の保存内容')
    expect(MODAL).toContain('上書きはできません')
    // 違う項目だけ。同じものは落とす。
    expect(MODAL).toMatch(/\.filter\(\(row\) => row\.mine !== row\.theirs\)/)
  })

  it('取り込んだら基準を進め、入力（下書き）は残す', () => {
    // 取り込みは基準だけ進める。入力の form には触らない。
    expect(MODAL).toContain('setBaseline(conflictLatest.updatedAt)')
    expect(MODAL).toContain('最新の内容を取り込みました')
    expect(MODAL).toContain('下書きのまま残っています')
  })

  it('作る側は日時を送らない', () => {
    // 新規作成に expectedUpdatedAt は付けない（作るものに読んだ日時は無い）。
    expect(MODAL).toContain('api.entryRoutes.create({ ...form, lineAccountId: accountId ?? null })')
    expect(MODAL).not.toContain('create({ ...form, lineAccountId: accountId ?? null, expectedUpdatedAt')
  })
})
