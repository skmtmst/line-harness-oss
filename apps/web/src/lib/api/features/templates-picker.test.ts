import { expect, it, vi } from 'vitest'
const request = vi.hoisted(() => vi.fn(async (_path: string) => ({ success: true, data: { items: [], total: 0 } })))
vi.mock('../transport/request', () => ({ fetchApi: request }))
const { templatesMethods } = await import('./templates')
it('文字だけの候補はAPIへ絞りを渡し、省略する呼び出しの約束は変えない', async () => {
  await templatesMethods.templates.listPage({ accountId: 'a', page: 2, textOnly: true, folderCounts: true })
  const query = new URL(request.mock.calls.at(-1)![0] as string, 'https://example.invalid').searchParams
  expect(query.get('text_only')).toBe('1')
  expect(query.get('account_id')).toBe('a')
  expect(query.get('page')).toBe('2')
  expect(query.get('folder_counts')).toBe('1')
  await templatesMethods.templates.listPage({})
  expect(new URL(request.mock.calls.at(-1)![0] as string, 'https://example.invalid').searchParams.has('text_only')).toBe(false)
})
