// @vitest-environment happy-dom
import React, { act, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ManualPublishAttempt } from './manual-publish-attempt'

function Harness({ calls, outcome }: { calls: string[]; outcome: 'fail' | 'success' }) {
  const attempt = useRef(new ManualPublishAttempt())
  const [, render] = useState(0)
  async function publish() {
    const key = attempt.current.begin()
    if (!key) return
    calls.push(key)
    await Promise.resolve()
    if (outcome === 'success') attempt.current.succeed()
    attempt.current.finish()
    render((value) => value + 1)
  }
  return <button onClick={() => void publish()}>公開</button>
}
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root; let container: HTMLDivElement
beforeEach(async () => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

describe('手動公開の二重押しとIdempotency-Key（本物のReact）', () => {
  it('同じ描画中の二重clickは1要求、失敗後は同key、成功後は新key', async () => {
    const calls: string[] = []
    await act(async () => { root.render(<Harness calls={calls} outcome="fail" />) })
    const button = container.querySelector('button')!
    await act(async () => { button.click(); button.click(); await Promise.resolve() })
    expect(calls).toHaveLength(1)
    await act(async () => { button.click(); await Promise.resolve() })
    expect(calls).toHaveLength(2); expect(calls[1]).toBe(calls[0])
    await act(async () => { root.render(<Harness calls={calls} outcome="success" />); await Promise.resolve() })
    await act(async () => { button.click(); await Promise.resolve() })
    await act(async () => { button.click(); await Promise.resolve() })
    expect(calls.at(-1)).not.toBe(calls.at(-2))
  })
})
