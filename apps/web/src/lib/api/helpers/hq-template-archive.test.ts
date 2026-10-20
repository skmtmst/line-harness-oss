import { beforeEach, expect, test, vi } from 'vitest'
vi.mock('../../api', () => ({fetchApi: vi.fn()}))
import { fetchApi } from '../../api'
import { hqTemplateArchiveApi } from './hq-template-archive'

beforeEach(() => vi.mocked(fetchApi).mockReset().mockResolvedValue({success: true, data: []}))
test('archive list forwards the type/status and returns counts with revisions', async () => {
  const result = {success: true, status: 'archived', archive_counts: {active: 4, archived: 1}, data: [{id: 'mark', revision: 3, archived_at: '2026-10-15'}]}
  vi.mocked(fetchApi).mockResolvedValueOnce(result)
  expect(await hqTemplateArchiveApi.list({type: 'mark', status: 'archived'})).toBe(result)
  expect(fetchApi).toHaveBeenLastCalledWith('/api/hq/templates?type=mark&status=archived', {method: 'GET'})
  await hqTemplateArchiveApi.list()
  expect(fetchApi).toHaveBeenLastCalledWith('/api/hq/templates', {method: 'GET'})
})
test('archive/restore encode IDs, bind the expected revision and preserve rejection', async () => {
  await hqTemplateArchiveApi.archive('mark/1', 2)
  expect(fetchApi).toHaveBeenLastCalledWith('/api/hq/templates/mark%2F1', {method: 'DELETE', body: JSON.stringify({expectedRevision: 2})})
  await hqTemplateArchiveApi.restore('mark/1', 3)
  expect(fetchApi).toHaveBeenLastCalledWith('/api/hq/templates/mark%2F1/restore', {method: 'POST', body: JSON.stringify({expectedRevision: 3})})
  const conflict = new Error('VERSION_CONFLICT')
  vi.mocked(fetchApi).mockRejectedValueOnce(conflict)
  await expect(hqTemplateArchiveApi.restore('mark/1', 3)).rejects.toBe(conflict)
})
