// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderPublishStep } from '../../../v8/rich-menus/new/create-publish-step'

type Context = Parameters<typeof renderPublishStep>[0]
let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  vi.unstubAllGlobals()
})

function context(overrides: Partial<Context> = {}): Context {
  return {
    accountId: null, aggregateOnly: false, areaActionSummary: () => '', audience: 'all',
    canOperate: true, checks: {
      self: { state: 'ok', message: null }, line: { state: 'yet', message: null },
      device: { state: 'yet', at: null }, pages: { state: 'ok', count: 1, max: 10 },
    },
    checksError: false, checksLoading: false, conditionEmpty: false, conditionUnsaved: false,
    done: null, endEnabled: false, goToStep: vi.fn(), group: null, host: undefined,
    loadChecks: vi.fn(async () => {}),
    nowNote: '保存したらすぐ、個別に指定した人を除くすべての友だちの既定メニューになります',
    pages: [], previewAreas: null, previewImageUrl: null,
    publishEffectNote: '個別に指定した人を除く、すべての友だちのトーク画面に出ます。既定のメニューが入れ替わります。',
    publishPlan: { mode: 'now', startsAt: '', endsAt: '', restoreGroupId: '' },
    recording: false, recordSeen: vi.fn(async () => {}), renderHqPublish: () => <></>,
    restoreMenus: [], setActivePageId: vi.fn(), setEndEnabled: vi.fn(), setSelectedAreaId: vi.fn(),
    size: 'large', staffRole: 'owner', targetPreview: null, totalAreaCount: 1,
    updatePublishPlan: vi.fn(), validateWithLine: vi.fn(async () => {}), validating: false,
    ...overrides,
  }
}
const buttons = (label: string) => [...host.querySelectorAll('button')].filter(button => button.textContent?.trim() === label)

describe('リッチメニューの公開前確認', () => {
  it('自前とLINEの見直しを、それぞれ正しい処理へ渡す', async () => {
    const state = context()
    await act(async () => { root.render(renderPublishStep(state)) })
    const retry = buttons('見直す')
    expect(retry).toHaveLength(2)
    await act(async () => { retry[0].click() })
    expect(state.loadChecks).toHaveBeenCalledOnce()
    expect(state.validateWithLine).not.toHaveBeenCalled()
    await act(async () => { retry[1].click() })
    expect(state.validateWithLine).toHaveBeenCalledOnce()
  })

  it('確認中・記録中の二度押しを防ぐ', async () => {
    const state = context({ checksLoading: true, validating: true, recording: true })
    await act(async () => { root.render(renderPublishStep(state)) })
    const busy = [...host.querySelectorAll('button')].filter(button => /確認中|記録中/.test(button.textContent ?? ''))
    expect(busy).toHaveLength(3)
    for (const button of busy) {
      expect(button.disabled).toBe(true)
      await act(async () => { button.click() })
    }
    expect(state.loadChecks).not.toHaveBeenCalled()
    expect(state.validateWithLine).not.toHaveBeenCalled()
    expect(state.recordSeen).not.toHaveBeenCalled()
  })

  it('実機確認を記録し、確認済みならその結果を表示する', async () => {
    const state = context()
    await act(async () => { root.render(renderPublishStep(state)) })
    expect(host.textContent).toContain('管理画面の見本だけでは公開できません')
    await act(async () => { buttons('スマホで見た')[0].click() })
    expect(state.recordSeen).toHaveBeenCalledOnce()
    await act(async () => { root.render(renderPublishStep(context({ checks: { ...state.checks!, device: { state: 'ok', at: null } } }))) })
    expect(host.textContent).toContain('スマホの実機で確認済みです')
  })

  it('取得失敗を未確認として示し、公開の影響を現在の段に表示する', async () => {
    await act(async () => { root.render(renderPublishStep(context({ checksError: true, checks: null, audience: 'none' }))) })
    expect(host.textContent).toContain('確認の状態を読み込めませんでした')
    expect(buttons('見直す')).toHaveLength(0)
    expect(host.textContent).toContain('LINEへの登録だけでは、友だちの画面は変わりません')
    expect(host.textContent).toContain('公開の前の確認')
  })
})
