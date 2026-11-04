import { vi } from 'vitest';

const deletionMocks = vi.hoisted(() => ({
  claim: vi.fn(async () => ({status:'checking',r2_keys_json:'["key-1"]'})),
  begin: vi.fn(async () => true),
  finish: vi.fn(async () => true),
  release: vi.fn(async () => undefined),
}));
export { deletionMocks };
vi.mock('../features/media/direct-media-usages.js', () => ({ findDirectMediaUsages: vi.fn(async () => []), countSentMediaMessages: vi.fn(async () => 0) }));
vi.mock('@line-crm/db/src/media/deletion-jobs.js', () => ({ claimMediaDeletion:deletionMocks.claim, beginMediaObjectDeletion:deletionMocks.begin, finishMediaDeletion:deletionMocks.finish, releaseUnstartedMediaDeletion:deletionMocks.release, releaseMediaDeletionLease:deletionMocks.release }));
vi.mock('../services/media-upload-storage.js', async importOriginal => ({ ...await importOriginal<typeof import('../services/media-upload-storage.js')>(), copyMediaUpload: vi.fn(async () => true) }));
