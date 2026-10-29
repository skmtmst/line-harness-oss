// @vitest-environment happy-dom
/*
 * 配信対象ステップの「この1週間に送った人を除く」は押せないまま置くが、
 * 理由（まだ使えない）は結び付ける（form-action-reason・FQA-1029）。
 * 見える small の文を変えず、aria-describedby で結ぶだけ。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://worker.test'
})

import { BroadcastAudienceStep } from './broadcast-audience-step'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root | null = null

afterEach(() => {
  if (root) {
    act(() => root!.unmount())
    root = null
  }
  host?.remove()
})

async function mount() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      <BroadcastAudienceStep
        audienceDisplayCount={null}
        audienceNotice={null}
        condition={null}
        excludeTagId=""
        exclusionNote={null}
        onRetryTags={undefined}
        openConditionDialog={() => {}}
        preflight={null}
        preflightStatus="idle"
        runPreflight={async () => {}}
        scenarioId=""
        scenarios={[]}
        scenariosStatus="ready"
        selectedAccountId="acc-1"
        setCondition={() => {}}
        setExcludeTagId={() => {}}
        setScenarioId={() => {}}
        setTagId={() => {}}
        setTargetMode={() => {}}
        shows={() => true}
        tagId=""
        tags={[]}
        tagsStatus="ready"
        targetMode="all"
      />,
    )
  })
}

describe('配信対象の除外（押せない理由の結び付け）', () => {
  it('押せない除外のチェックに理由が結び付く', async () => {
    await mount()
    const box = host.querySelector('input[type="checkbox"][disabled]') as HTMLInputElement | null
    expect(box).not.toBeNull()
    const describedId = box!.getAttribute('aria-describedby')
    expect(describedId).toBeTruthy()
    const note = describedId ? host.querySelector(`#${CSS.escape(describedId)}`) : null
    expect(note?.textContent ?? '').toContain('まだ使えません')
  })
})
