import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(process.cwd(), 'src', 'app', 'booking', 'menus')
const LIST = readFileSync(join(ROOT, 'page.tsx'), 'utf8')
const CREATE = readFileSync(join(ROOT, 'new', 'page.tsx'), 'utf8')

describe('V6 予約設定', () => {
  it('V6の一覧・状態・作成画面を実ノードへ結び付ける', () => {
    expect(LIST).toContain('data-design-node="QSLEH"')
    expect(LIST).toContain('data-design-node="W6465r"')
    expect(CREATE).toContain('designNode="GhOb3"')
  })

  it('本文に画面タイトルを重ねず、行き先が分かる操作名にする', () => {
    expect(LIST).not.toContain('<Header')
    expect(CREATE).toContain('showHeader={false}')
    expect(LIST).toContain('予約メニューを作る')
    expect(LIST).toContain('受付枠と休業日を設定')
  })

  it('表示している一覧操作は実際に使える', () => {
    expect(LIST).not.toContain('準備中')
    expect(LIST).toContain('aria-label="並び順"')
    expect(LIST).toContain('aria-label="集計期間"')
    expect(LIST).toContain('onClick={exportCsv}')
  })

  it('読込・失敗・空を同じ空状態として扱わない', () => {
    expect(LIST).toContain('<ListState kind="loading"')
    expect(LIST).toContain('<ListState kind="error"')
    expect(LIST).toContain('kind="empty"')
  })
})
