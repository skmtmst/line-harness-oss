import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DuplicateAborted, duplicateScenario } from './duplicate-scenario'

const mocks = vi.hoisted(() => ({
  get: vi.fn(), create: vi.fn(), update: vi.fn(), addStep: vi.fn(),
  listTriggers: vi.fn(), addTrigger: vi.fn(), listActions: vi.fn(), createAction: vi.fn(),
}))
vi.mock('@/lib/api', async (original) => ({
  ...await original<typeof import('@/lib/api')>(),
  api: { scenarios: {
    get: mocks.get, create: mocks.create, update: mocks.update, addStep: mocks.addStep,
    triggers: { list: mocks.listTriggers, add: mocks.addTrigger },
    actions: { list: mocks.listActions, create: mocks.createAction },
  } },
}))

const source = () => ({
  name: '元のシナリオ', description: '説明', triggerType: 'manual', triggerTagId: null,
  lineAccountId: 'account-a', deliveryMode: 'relative', allowConcurrent: true, folderId: 'folder-a',
  audienceCondition: { type: 'all' }, onCompleteMode: 'pause', onCompleteScenarioId: null,
  steps: [2, 1].map(n => ({
    id: `step-${n}`, stepOrder: n, delayMinutes: n * 10, messageType: 'text',
    messageContent: { text: `本文${n}` }, afterSend: n === 1 ? 'pause' : 'continue', isDraft: n === 2,
  })),
})
const triggers = [
  { kind: 'tag_added', tagId: 'tag-a' },
  { kind: 'tag_removed', tagId: 'tag-b' },
]
const actions = [1, 2].map(n => ({
  hook: 'step_reached', stepId: `step-${n}`, choiceIndex: null, actionType: 'add_tag',
  sortOrder: n, config: { tagId: `tag-${n}` }, condition: null, repeatOnRefire: false,
}))
const writes = () => [mocks.create, mocks.update, mocks.addStep, mocks.addTrigger, mocks.createAction]
const writeCount = () => writes().reduce((n, fn) => n + fn.mock.calls.length, 0)
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.get.mockResolvedValue({ success: true, data: source() })
  mocks.create.mockResolvedValue({ success: true, data: { id: 'copy-a' } })
  mocks.update.mockResolvedValue({ success: true, data: {} })
  mocks.addStep.mockImplementation(async (_id, step) => ({ success: true, data: { id: `copy-step-${step.stepOrder}` } }))
  mocks.listTriggers.mockImplementation(async id => ({ success: true, data: id === 'source-a' ? triggers : [] }))
  mocks.addTrigger.mockResolvedValue({ success: true, data: {} })
  mocks.listActions.mockImplementation(async id => ({ success: true, data: id === 'source-a' ? actions : [] }))
  mocks.createAction.mockResolvedValue({ success: true, data: {} })
})

describe('シナリオ複製の任意の実行前確認', () => {
  it.each([undefined, () => true])('未指定/許可中は既存の全内容と順序を保つ (%s)', async canWriteNow => {
    expect(await duplicateScenario('source-a', '新しい名前', canWriteNow)).toBe('copy-a')
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      name: '新しい名前', description: '説明', triggerType: 'manual', triggerTagId: null,
      lineAccountId: 'account-a', isActive: false, deliveryMode: 'relative', allowConcurrent: true, folderId: 'folder-a',
    })
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith('copy-a', {
      audienceCondition: { type: 'all' }, onCompleteMode: 'pause', onCompleteScenarioId: null,
    })
    expect(mocks.addStep.mock.calls.map(call => call[1])).toEqual([1, 2].map(n => ({
      stepOrder: n, delayMinutes: n * 10, messageType: 'text', messageContent: { text: `本文${n}` },
      templateId: null, onReachTagId: null, afterSend: n === 1 ? 'pause' : 'continue',
      targetCondition: null, question: null, isDraft: n === 2,
    })))
    expect(mocks.addTrigger.mock.calls).toEqual(triggers.map(t => ['copy-a', t.kind, t.tagId]))
    expect(mocks.createAction.mock.calls).toEqual(actions.map(a => ['copy-a', { ...a, stepId: `copy-${a.stepId}` }]))
    expect(writeCount()).toBe(8)
  })

  it('最初から拒否なら書込0で理由を返す', async () => {
    await expect(duplicateScenario('source-a', 'コピー', () => false)).rejects.toThrow('権限が変わったため、複製を中止しました。')
    expect(writeCount()).toBe(0)
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('元を読む間に拒否になれば作成0、コピーはまだ無い', async () => {
    let allowed = true
    const wait = deferred<{ success: true; data: ReturnType<typeof source> }>()
    mocks.get.mockReturnValue(wait.promise)
    const pending = duplicateScenario('source-a', 'コピー', () => allowed)
    allowed = false
    wait.resolve({ success: true, data: source() })
    const error = await pending.catch(error => error)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(DuplicateAborted)
    expect(error.message).toContain('権限が変わったため')
    expect(writeCount()).toBe(0)
  })

  const phases = [
    ['作成', 'create', 1, 1, 'シナリオ全体の設定'],
    ['全体設定', 'update', 1, 2, 'シナリオ全体の設定'],
    ['1通目', 'addStep', 1, 3, '1通目のコピー'],
    ['2通目', 'addStep', 2, 4, '2通目のコピー'],
    ['きっかけの読取', 'listTriggers', 1, 4, '開始のきっかけ'],
    ['きっかけ1', 'addTrigger', 1, 5, '開始のきっかけ'],
    ['きっかけ2', 'addTrigger', 2, 6, '開始のきっかけ'],
    ['動作の読取', 'listActions', 1, 6, 'アクション'],
    ['動作1', 'createAction', 1, 7, 'アクション'],
    ['動作2', 'createAction', 2, 8, 'アクション'],
  ] as const
  it.each(phases)('%sの応答待ちで拒否になると以後0・コピーIDと停止段階を残す', async (_label, key, call, count, stage) => {
    let allowed = true
    let entered!: () => void
    const started = new Promise<void>(done => { entered = done })
    const wait = deferred<{ success: true; data: unknown }>()
    const fn = mocks[key]
    const original = fn.getMockImplementation()!
    let calls = 0
    fn.mockImplementation((...args) => {
      calls += 1
      if (calls === call) { entered(); return wait.promise }
      return original(...args)
    })
    const pending = duplicateScenario('source-a', 'コピー', () => allowed)
    await started
    allowed = false
    const data = key === 'create' ? { id: 'copy-a' }
      : key === 'addStep' ? { id: `copy-step-${call}` }
      : key === 'listTriggers' ? triggers : key === 'listActions' ? actions : {}
    wait.resolve({ success: true, data })
    const error = await pending.catch(error => error)
    expect(error).toBeInstanceOf(DuplicateAborted)
    expect(error).toMatchObject({ copyId: 'copy-a', stage: expect.stringContaining(stage) })
    expect(error.message).toContain('権限が変わったため')
    expect(writeCount()).toBe(count)
    // 許可復帰だけでは勝手に残りを送らない。
    allowed = true
    await Promise.resolve()
    expect(writeCount()).toBe(count)
  })

  it.each(['elapsed', 'absolute_time'] as const)('%s方式は従来どおり必要な時刻の欄だけを送る', async mode => {
    const data = source()
    mocks.get.mockResolvedValue({ success: true, data: {
      ...data, deliveryMode: mode,
      steps: [{ ...data.steps[0], offsetDays: 3, offsetMinutes: 25, deliveryTime: '14:30' }],
    } })
    await duplicateScenario('source-a', 'コピー')
    const schedule = mocks.addStep.mock.calls[0][1]
    expect(schedule).not.toHaveProperty('delayMinutes')
    expect(schedule.offsetDays).toBe(3)
    if (mode === 'elapsed') {
      expect(schedule.offsetMinutes).toBe(25)
      expect(schedule).not.toHaveProperty('deliveryTime')
    } else {
      expect(schedule.deliveryTime).toBe('14:30')
      expect(schedule).not.toHaveProperty('offsetMinutes')
    }
  })

  it('既存のきっかけ/動作は重複せず、写せなかった通の動作は足さない', async () => {
    mocks.listTriggers.mockResolvedValue({ success: true, data: triggers })
    mocks.listActions.mockImplementation(async id => ({ success: true, data: id === 'source-a'
      ? [...actions, { ...actions[0], stepId: 'missing-step' }]
      : [{ ...actions[0], stepId: 'copy-step-1' }] }))
    await duplicateScenario('source-a', 'コピー')
    expect(mocks.addTrigger).not.toHaveBeenCalled()
    expect(mocks.createAction).toHaveBeenCalledExactlyOnceWith('copy-a', { ...actions[1], stepId: 'copy-step-2' })
  })

  it.each(['get', 'create'] as const)('%sの既存API失敗はコピーIDを作らず返す', async key => {
    mocks[key].mockResolvedValue({ success: false, error: '入力を直してください。' })
    const error = await duplicateScenario('source-a', 'コピー').catch(error => error)
    expect(error).not.toBeInstanceOf(DuplicateAborted)
    expect(error.message).toBe('入力を直してください。')
  })
  it.each([
    ['update', 'シナリオ全体の設定'], ['addStep', '1通目のコピー'],
    ['addTrigger', '開始のきっかけ'], ['createAction', 'アクション'],
  ] as const)('%sの既存API失敗でも部分コピーIDを残す', async (key, stage) => {
    mocks[key].mockRejectedValue(new Error('通信に失敗しました。'))
    const error = await duplicateScenario('source-a', 'コピー').catch(error => error)
    expect(error).toMatchObject({ copyId: 'copy-a', stage: expect.stringContaining(stage) })
    expect(error.message).toContain('通信に失敗しました。')
  })
})
