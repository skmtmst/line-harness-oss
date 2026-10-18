// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import EditDialog, { toDraft } from './edit-dialog'

vi.mock('@/lib/api', () => ({
  api: { folders: { list: vi.fn(async () => ({ success: true, data: [] })) } },
}))
vi.mock('./inline-action-list', () => ({
  default: () => null,
  useActionOptions: () => ({ tags: [], fields: [], marks: [], scenarios: [], vars: [] }),
}))
vi.mock('@/components/shared/condition-builder', () => ({ default: () => null }))
vi.mock('@/components/shared/image-uploader', () => ({ default: () => null }))

// 分割ファイルのimport順ではなく、実際に表示された手順を確かめる。
it('編集窓の段が上から1・2・3・4の順に出る', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    const draft = toDraft({
      id: 'reply-1', keyword: '予約', matchType: 'contains', responseType: 'text',
      responseContent: '承りました', templateId: null, lineAccountId: 'account-1',
      isActive: true, priority: 10,
    })
    await act(async () => {
      root.render(<EditDialog draft={draft} templates={[]} onClose={vi.fn()} onSaved={vi.fn()} />)
    })
    expect([...document.querySelectorAll('h2, h3, p')].map(node => node.textContent).filter(text => /^\d\./.test(text ?? ''))).toEqual([
      '1. どのメッセージに反応するか',
      '2. いつ・誰に反応するか',
      '3. 何を返すか',
      '4. 応答したときに行うこと',
    ])
  } finally {
    await act(async () => { root.unmount() })
    host.remove()
    vi.unstubAllGlobals()
  }
})
