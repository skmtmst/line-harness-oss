import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/**
 * #975 U061: 10件の開始イベントを最初から並べない。
 * 検索・代表3件・「すべてを見る」・分類で段階的に選ぶ。
 * #975 U073: 下書き保存と動かし始めることを分け、動かす前に
 * 対象・きっかけ・最初の実行・止め方を確認する。
 */
describe('きっかけの段階的な選択（#975 U061）', () => {
  it('言葉で検索できる', () => {
    expect(PAGE).toContain('aria-label="きっかけを探す"')
    expect(PAGE).toContain('normalizedEventQuery')
    expect(PAGE).toContain('合うきっかけがありません')
  })

  it('代表のきっかけと「すべてを見る」がある', () => {
    expect(PAGE).toContain('REPRESENTATIVE_TRIGGER_EVENTS')
    expect(PAGE).toContain('ほかのきっかけもすべて見る')
  })

  it('きっかけを分類して並べる', () => {
    expect(PAGE).toContain('TRIGGER_EVENT_GROUPS')
    expect(PAGE).toContain('友だちやお客さんの動き')
    expect(PAGE).toContain('決めた時刻・曜日')
  })

  it('選択後は関係する入力だけが出る', () => {
    expect(PAGE).toContain("['tag_change', 'form_submitted', 'link_clicked', 'calendar_booked', 'datetime', 'daily', 'weekly'].includes(eventType)")
    expect(PAGE).toContain("eventType === 'tag_change'")
    expect(PAGE).toContain("eventType === 'calendar_booked'")
  })
})

describe('作成と動かし始めることの分離（#975 U073）', () => {
  it('下書き保存と動かし始める操作が別のボタン', () => {
    expect(PAGE).toContain('onClick={() => void save(false)}')
    expect(PAGE).toContain('下書きに保存')
    expect(PAGE).toContain('つくって動かす')
  })

  it('動かし始める前に確認ダイアログを挟む', () => {
    expect(PAGE).toContain('setActivateConfirmOpen(true)')
    expect(PAGE).toContain('この内容で動かし始めますか')
    expect(PAGE).toContain('保存して動かし始める')
    // 確認には対象・きっかけ・最初の実行・止め方を載せる。
    expect(PAGE).toContain('だれに')
    expect(PAGE).toContain('最初に動くのは')
    expect(PAGE).toContain('止め方')
  })
})
