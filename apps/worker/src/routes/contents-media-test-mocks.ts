import { vi } from 'vitest';

vi.mock('../features/media/direct-media-usages.js', () => ({ findDirectMediaUsages: vi.fn(async () => []) }));
vi.mock('../services/media-upload-storage.js', async importOriginal => ({ ...await importOriginal<typeof import('../services/media-upload-storage.js')>(), copyMediaUpload: vi.fn(async () => true) }));
