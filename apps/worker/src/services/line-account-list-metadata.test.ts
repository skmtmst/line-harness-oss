import { expect, it, vi } from 'vitest';
const reads = vi.hoisted(() => ({ tags: vi.fn(), folders: vi.fn(), stats: vi.fn() }));
vi.mock('@line-crm/db', () => ({
  getLineAccountTagsByAccountIds: reads.tags,
  getLineAccountFoldersByAccountIds: reads.folders,
  getLineAccountListStats: reads.stats,
}));
import { readLineAccountListMetadata } from './line-account-list-metadata.js';

it('先の補足情報が未完了でも残りの読取を始め、同じ店舗に絞る', async () => {
  let answer!: (value: object) => void;
  reads.tags.mockImplementation(() => new Promise(resolve => { answer = resolve; }));
  reads.folders.mockResolvedValue({ store: { id: 'folder' } });
  reads.stats.mockResolvedValue({ store: { friendCount: 3 } });
  const db = {} as D1Database;
  const pending = readLineAccountListMetadata(db, 'tenant', ['store']);
  expect(reads.tags).toHaveBeenCalledWith(db, 'tenant', ['store']);
  expect(reads.folders).toHaveBeenCalledWith(db, 'tenant', ['store']);
  expect(reads.stats).toHaveBeenCalledWith(db, ['store']);
  answer({ store: ['tag'] });
  expect(await pending).toEqual({ tagsByAccount: { store: ['tag'] }, foldersByAccount: { store: { id: 'folder' } }, statsByAccount: { store: { friendCount: 3 } } });
});
