import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const FORM = readFileSync(join(HERE, 'menu-form-v8.tsx'), 'utf8')

/*
 * 予約メニュー編集の同時編集（板 v5L19Z・v8f の口）。
 *
 * 保存は版に加えて、開いたときの更新日時も送る。日時・版のどちらかが
 * ずれれば409になり、板の帯（違いを比べる・最新を読み込んで続ける）が出る。
 * 競合からの上書きは、読み直した最新の日時を使う。
 */
describe('メニュー編集の同時編集 (v5L19Z)', () => {
  it('保存は読んだ更新日時を付けて送る', () => {
    expect(FORM).toContain('expectedUpdatedAt')
    expect(FORM).toContain('editTarget?.updated_at')
  })

  it('競合からの上書きは読み直した最新の日時を使う', () => {
    expect(FORM).toContain('overwrite && conflict ? conflict.updatedAt : editTarget?.updated_at')
    // 読み直しで最新の日時も拾う。
    expect(FORM).toContain('updatedAt: latestMenu?.updated_at ?? null')
  })

  it('409の帯は板の文面のまま残す', () => {
    // 帯・比べ・読み直しの操作を消さない。
    expect(FORM).toContain('違いを比べる')
    expect(FORM).toContain('最新を読み込んで続ける')
    expect(FORM).toContain('openConflict(menuId)')
  })
})
