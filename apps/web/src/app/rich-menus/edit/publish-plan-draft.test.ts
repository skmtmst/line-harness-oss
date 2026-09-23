import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PUBLISH_PLAN,
  clearPublishPlanDraft,
  loadPublishPlanDraft,
  savePublishPlanDraft,
  type PublishPlanInput,
} from './publish-plan-draft'

/** localStorage の代わり。試験ごとに空で始める。 */
class MemoryStorage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

const SCHEDULED: PublishPlanInput = {
  mode: 'scheduled',
  startsAt: '2026-10-01T10:00',
  endsAt: '',
  restoreGroupId: '',
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
})

describe('公開入力の下書き (publish-plan-draft)', () => {
  it('書いた内容を同じメニューIDで読める', () => {
    savePublishPlanDraft('g-1', SCHEDULED)
    expect(loadPublishPlanDraft('g-1')).toEqual(SCHEDULED)
  })

  it('別のメニューIDでは読めない（下書きが混ざらない）', () => {
    savePublishPlanDraft('g-1', SCHEDULED)
    expect(loadPublishPlanDraft('g-2')).toBeNull()
  })

  it('初期値は書き残さない（「いますぐ出す」に戻した下書きは消える）', () => {
    savePublishPlanDraft('g-1', SCHEDULED)
    savePublishPlanDraft('g-1', DEFAULT_PUBLISH_PLAN)
    expect(loadPublishPlanDraft('g-1')).toBeNull()
  })

  it('clear で消える', () => {
    savePublishPlanDraft('g-1', SCHEDULED)
    clearPublishPlanDraft('g-1')
    expect(loadPublishPlanDraft('g-1')).toBeNull()
  })

  it('壊れたJSON・形の違う値は「下書きなし」として読む', () => {
    localStorage.setItem('lh_rich_menu_publish_plan_g-1', '{broken')
    expect(loadPublishPlanDraft('g-1')).toBeNull()

    localStorage.setItem('lh_rich_menu_publish_plan_g-1', JSON.stringify({ mode: 'tomorrow' }))
    expect(loadPublishPlanDraft('g-1')).toBeNull()

    localStorage.setItem('lh_rich_menu_publish_plan_g-1', JSON.stringify('just-a-string'))
    expect(loadPublishPlanDraft('g-1')).toBeNull()
  })

  it('localStorage が使えなくても落ちない', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
      removeItem: () => { throw new Error('denied') },
    })
    expect(() => savePublishPlanDraft('g-1', SCHEDULED)).not.toThrow()
    expect(loadPublishPlanDraft('g-1')).toBeNull()
    expect(() => clearPublishPlanDraft('g-1')).not.toThrow()
  })
})
