import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import EmergencyPage from './page'

const {
  EmergencyControlFeedback,
  emergencySafetyTransition,
  isEmergencyMutationLocked,
  runCurrentRequest,
} = EmergencyPage.__test

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function renderFeedback({
  tone = 'warning',
  text,
  needsReload,
  reloading = false,
  previewSettled = false,
  stopBlockers = [],
}: {
  tone?: 'success' | 'warning' | 'danger'
  text: string
  needsReload: boolean
  reloading?: boolean
  previewSettled?: boolean
  stopBlockers?: Array<'unavailable' | 'forbidden' | 'scope' | 'empty' | 'stopped'>
}) {
  return renderToStaticMarkup(React.createElement(EmergencyControlFeedback, {
    message: { tone, text },
    needsReload,
    reloading,
    previewSettled,
    stopBlockers,
    onReload: vi.fn(),
  }))
}

describe('N-453/N-455 緊急コントロールの実挙動', () => {
  it('遅いAアカウントの応答を、Bへ切り替えた後に反映しない', async () => {
    let generation = 0
    let visibleAccount = '未取得'
    const accountA = deferred<string>()
    const accountB = deferred<string>()

    const requestA = ++generation
    const pendingA = runCurrentRequest({
      request: () => accountA.promise,
      isCurrent: () => generation === requestA,
      onSuccess: (account) => { visibleAccount = account },
      onError: vi.fn(),
    })

    const requestB = ++generation
    const pendingB = runCurrentRequest({
      request: () => accountB.promise,
      isCurrent: () => generation === requestB,
      onSuccess: (account) => { visibleAccount = account },
      onError: vi.fn(),
    })

    accountB.resolve('Bアカウント')
    await pendingB
    accountA.resolve('Aアカウント')
    await pendingA

    expect(visibleAccount).toBe('Bアカウント')
    const html = renderFeedback({ tone: 'success', text: visibleAccount, needsReload: false })
    expect(html).toContain('Bアカウント')
    expect(html).not.toContain('Aアカウント')
  })

  it('切替前リクエストの遅い失敗も、Bの成功表示を壊さない', async () => {
    let generation = 0
    let visible = '未取得'
    const errors: string[] = []
    const accountA = deferred<string>()
    const accountB = deferred<string>()

    const requestA = ++generation
    const pendingA = runCurrentRequest({
      request: () => accountA.promise,
      isCurrent: () => generation === requestA,
      onSuccess: (value) => { visible = value },
      onError: (error) => { errors.push(String(error)) },
    })
    const requestB = ++generation
    const pendingB = runCurrentRequest({
      request: () => accountB.promise,
      isCurrent: () => generation === requestB,
      onSuccess: (value) => { visible = value },
      onError: (error) => { errors.push(String(error)) },
    })

    accountB.resolve('Bの最新状態')
    await pendingB
    accountA.reject(new Error('Aの遅い失敗'))
    await pendingA

    expect(visible).toBe('Bの最新状態')
    expect(errors).toEqual([])
  })

  it('409後は再読込だけを表示し、停止・復旧・本人確認をロックする', () => {
    const state = emergencySafetyTransition('conflict')
    const html = renderFeedback({
      tone: state.message?.tone,
      text: state.message?.text ?? '',
      needsReload: state.needsReload,
    })

    expect(state.clearPreview).toBe(true)
    expect(state.closeDialogs).toBe(true)
    expect(html).toContain('最新の状態を読み直す')
    expect(isEmergencyMutationLocked(state.needsReload, false)).toBe(true)
    expect(isEmergencyMutationLocked(false, true)).toBe(true)
    expect(isEmergencyMutationLocked(false, false)).toBe(false)
  })

  it('再読込成功後は競合表示を消し、再試行できる', async () => {
    const generation = 1
    let state = emergencySafetyTransition('conflict')
    const reload = deferred<string>()

    await Promise.all([
      runCurrentRequest({
        request: () => reload.promise,
        isCurrent: () => generation === 1,
        onSuccess: () => { state = emergencySafetyTransition('reload-success') },
        onError: vi.fn(),
      }),
      Promise.resolve().then(() => reload.resolve('最新の状態を読み直しました。内容を確認して、もう一度実行してください。')),
    ])

    const html = renderFeedback({ tone: state.message?.tone, text: state.message?.text ?? '', needsReload: state.needsReload })
    expect(html).toContain('もう一度実行してください')
    expect(html).not.toContain('最新の状態を読み直す</button>')
    expect(isEmergencyMutationLocked(state.needsReload, false)).toBe(false)
  })

  it('再読込失敗時は古い確認内容を破棄し、再読込導線を残す', async () => {
    const generation = 1
    let oldPreview: string | null = 'Aの古い確認内容'
    let state = emergencySafetyTransition('conflict')
    const reload = deferred<string>()

    state = emergencySafetyTransition('reload-start')
    if (state.clearPreview) oldPreview = null
    const pending = runCurrentRequest({
      request: () => reload.promise,
      isCurrent: () => generation === 1,
      onSuccess: vi.fn(),
      onError: () => { state = emergencySafetyTransition('reload-failure') },
    })
    reload.reject(new Error('network error'))
    await pending

    expect(oldPreview).toBeNull()
    expect(state.clearPreview).toBe(true)
    expect(state.closeDialogs).toBe(true)
    const html = renderFeedback({ tone: state.message?.tone, text: state.message?.text ?? '', needsReload: state.needsReload, previewSettled: true, stopBlockers: ['unavailable'] })
    expect(html).toContain('読み直せませんでした')
    expect(html).toContain('最新の状態を読み直す')
    expect(html).toContain('停止・復旧を実行できません')
    expect(html).not.toContain('Aの古い確認内容')
  })

  it('失敗後の再試行が成功すれば、最新内容だけを表示する', async () => {
    const generation = 1
    let visible: string | null = null
    let state = emergencySafetyTransition('reload-failure')
    const retry = deferred<string>()

    const pending = runCurrentRequest({
      request: () => retry.promise,
      isCurrent: () => generation === 1,
      onSuccess: (value) => {
        visible = value
        state = emergencySafetyTransition('reload-success')
      },
      onError: vi.fn(),
    })
    retry.resolve('Bの再取得内容')
    await pending

    const html = renderFeedback({ tone: state.message?.tone, text: visible ?? '', needsReload: state.needsReload })
    expect(html).toContain('Bの再取得内容')
    expect(isEmergencyMutationLocked(state.needsReload, false)).toBe(false)
  })
})
