// @vitest-environment happy-dom
import React, { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 公開予約の「応答が返ってこなかったときの押し直し」を本物のReactで動かす試験(#621)。
 *
 * 押すたびに新しい Idempotency-Key を作っていると、通信が切れて応答が返らない
 * ままもう一度押したときにサーバーには別の操作に見え、同じ予約が2件できる。
 * ここは本物の React(react-dom/client)・本物の DOM 操作(ラジオ・日時入力・
 * 送信ボタン)で、実際に送られた Idempotency-Key だけを見る。
 * 差し替えるのは通信(api)と next のルーティングだけ。
 */

const net = vi.hoisted(() => ({
  /** schedule に届いた (キー, 中身) の記録。 */
  scheduleCalls: [] as Array<{ key: string; input: Record<string, unknown> }>,
  /** 次の schedule 応答。'lost' は応答が返ってこない(通信断)。 */
  scheduleResult: 'ok' as 'ok' | 'lost' | 'conflict',
}))

vi.mock('next/link', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}))

vi.mock('@/lib/api', async (importOriginal: () => Promise<typeof import('@/lib/api')>) => {
  const actual = await importOriginal()
  return {
    ...actual,
    api: {
      ...actual.api,
      richMenuGroups: {
        ...actual.api.richMenuGroups,
        list: async () => ({ success: true, data: [] }),
        listSchedules: async () => ({ success: true, data: [] }),
        schedule: async (
          _groupId: string,
          input: Record<string, unknown>,
          idempotencyKey: string,
        ) => {
          net.scheduleCalls.push({ key: idempotencyKey, input })
          if (net.scheduleResult === 'lost') {
            // 応答が返ってこない。届いたのかどうかも分からない。
            throw new TypeError('Failed to fetch')
          }
          if (net.scheduleResult === 'conflict') {
            return { success: false, error: '同じ内容の予約がすでにあります' }
          }
          return { success: true, data: { id: 'schedule-1', status: 'scheduled' } }
        },
      },
    },
  }
})

const { default: RichMenuEditPage } = await import('./page')
const { useScheduleSubmit, SCHEDULE_SAVED_MESSAGE, SCHEDULE_FAILED_MESSAGE } = await import('./schedule-submit')

const { PublishStep } = (RichMenuEditPage as unknown as {
  __testing: { PublishStep: React.ComponentType<Record<string, unknown>> }
}).__testing

const group = {
  id: 'menu-1',
  accountId: 'account-1',
  name: 'キャンペーン',
  chatBarText: 'メニュー',
  size: 'large' as const,
  defaultPageId: null,
  isDefaultForAll: false,
  status: 'draft' as const,
  publishingAt: null,
  targetingCondition: null,
  targetingPriority: 0,
  targetingEnabled: false,
  folderId: null,
  pages: [],
}

const pages = [
  {
    id: 'p1',
    orderIndex: 0,
    name: '1枚目',
    aliasId: 'lhx-menu-1-0',
    lineRichmenuId: null,
    imageR2Key: 'img',
    imageContentType: 'image/jpeg',
    areas: [],
  },
]

/** 本物の hook と本物の PublishStep を組み合わせた画面。 */
function Harness() {
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = useScheduleSubmit({
    groupId: group.id,
    persistDraft: async () => {},
    onSaving: setSaving,
    onSaved: (message) => {
      setError('')
      setNotice(message)
    },
    onFailed: (message) => {
      setNotice('')
      setError(message)
    },
  })
  return (
    <div>
      <p data-testid="notice">{notice}</p>
      <p data-testid="error">{error}</p>
      <PublishStep
        group={group}
        pages={pages}
        preview={null}
        saving={saving}
        publishing={false}
        onSave={() => {}}
        onPublishNow={() => {}}
        onSchedule={submit}
      />
    </div>
  )
}

// act(...) を使う環境だと React に伝える(伝えないと警告が出続ける)。
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** React が値の変化を見落とさないように、ネイティブの setter で入れる。 */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function findByText<T extends Element>(selector: string, text: string): T {
  const found = [...container.querySelectorAll(selector)].find((node) =>
    (node.textContent ?? '').includes(text),
  )
  if (!found) throw new Error(`見つかりません: ${selector} / ${text}`)
  return found as T
}

async function fillScheduleForm(startsAt: string) {
  const modeRadio = [...container.querySelectorAll<HTMLInputElement>('input[name="publish-mode"]')][1]
  await act(async () => {
    modeRadio.click()
  })
  const startsAtInput = container.querySelector<HTMLInputElement>('input[aria-label="出しはじめ"]')!
  await act(async () => {
    typeInto(startsAtInput, startsAt)
  })
}

async function pressReserve() {
  const button = findByText<HTMLButtonElement>('button', 'この内容で予約する')
  await act(async () => {
    button.click()
  })
  await flush()
}

beforeEach(async () => {
  net.scheduleCalls.length = 0
  net.scheduleResult = 'ok'
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<Harness />)
  })
  await flush()
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
})

describe('公開予約の Idempotency-Key（本物のReact）', () => {
  it('応答が返らなかった押し直しは同じキーで送り、予約を2件にしない', async () => {
    await fillScheduleForm('2026-09-20T10:00')

    net.scheduleResult = 'lost'
    await pressReserve()
    expect(net.scheduleCalls).toHaveLength(1)
    expect(container.querySelector('[data-testid="error"]')?.textContent).toBe(SCHEDULE_FAILED_MESSAGE)

    // 同じ内容のまま押し直す。応答が確定していないのでキーは変えない。
    net.scheduleResult = 'ok'
    await pressReserve()
    expect(net.scheduleCalls).toHaveLength(2)
    expect(net.scheduleCalls[1].key).toBe(net.scheduleCalls[0].key)
    expect(net.scheduleCalls[1].input).toEqual(net.scheduleCalls[0].input)
    expect(container.querySelector('[data-testid="notice"]')?.textContent).toBe(SCHEDULE_SAVED_MESSAGE)
    expect(container.querySelector('[data-testid="error"]')?.textContent).toBe('')
  })

  it('保存できたあとの予約は新しいキーになる（別の操作として通る）', async () => {
    await fillScheduleForm('2026-09-20T10:00')
    await pressReserve()
    await pressReserve()

    expect(net.scheduleCalls).toHaveLength(2)
    expect(net.scheduleCalls[1].key).not.toBe(net.scheduleCalls[0].key)
  })

  it('サーバーが断ってもキーは変えない（同じ内容の押し直しを2件にしない）', async () => {
    await fillScheduleForm('2026-09-20T10:00')

    net.scheduleResult = 'conflict'
    await pressReserve()
    await pressReserve()

    expect(net.scheduleCalls).toHaveLength(2)
    expect(net.scheduleCalls[1].key).toBe(net.scheduleCalls[0].key)
    expect(container.querySelector('[data-testid="error"]')?.textContent).toBe(SCHEDULE_FAILED_MESSAGE)
  })

  it('応答が返らないまま中身を直したら、別の操作として新しいキーになる', async () => {
    await fillScheduleForm('2026-09-20T10:00')

    net.scheduleResult = 'lost'
    await pressReserve()

    net.scheduleResult = 'ok'
    await fillScheduleForm('2026-09-21T10:00')
    await pressReserve()

    expect(net.scheduleCalls).toHaveLength(2)
    expect(net.scheduleCalls[1].key).not.toBe(net.scheduleCalls[0].key)
    expect(net.scheduleCalls[1].input.startsAt).not.toBe(net.scheduleCalls[0].input.startsAt)
  })
})
