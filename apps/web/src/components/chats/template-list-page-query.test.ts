/*
 * 受信箱のテンプレート選択が使う一覧の口。選んだフォルダは folder_id のまま Worker へ渡す
 * （親を選んだとき直下の子も含めるのは Worker 側。templates-picker-filter の試験が見る）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/transport/request', () => ({ fetchApi: vi.fn(async () => ({ success: true, data: { items: [], total: 0, limit: 100 } })) }))

import { fetchApi } from '@/lib/api/transport/request'
import { templatesMethods } from '@/lib/api/features/templates'

describe('テンプレート一覧の口', () => {
  beforeEach(() => vi.mocked(fetchApi).mockClear())

  it('選んだフォルダ・未分類を folder_id で渡し、アカウントも落とさない', async () => {
    await templatesMethods.templates.listPage({ accountId: 'acc-1', folderId: 'f-1', page: 2 })
    const path = String(vi.mocked(fetchApi).mock.calls[0][0])
    const query = new URLSearchParams(path.split('?')[1])
    expect(query.get('folder_id')).toBe('f-1')
    expect(query.get('account_id')).toBe('acc-1')
    expect(query.get('page')).toBe('2')

    await templatesMethods.templates.listPage({ accountId: 'acc-1', folderId: '__none__' })
    expect(new URLSearchParams(String(vi.mocked(fetchApi).mock.calls[1][0]).split('?')[1]).get('folder_id')).toBe('__none__')
  })

  it('フォルダを選んでいないときは folder_id を付けない', async () => {
    await templatesMethods.templates.listPage({ accountId: 'acc-1' })
    expect(String(vi.mocked(fetchApi).mock.calls[0][0])).not.toContain('folder_id')
  })
})
