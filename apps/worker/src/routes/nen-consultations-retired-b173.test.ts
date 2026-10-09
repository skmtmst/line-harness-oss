import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { nenMembers } from './nen-members.js';

describe('B-173 使わない然の相談API', () => {
  it.each([
    ['POST', '/api/liff/nen/consultations'],
    ['GET', '/api/nen-members/consultations'],
  ])('%s %s は受付を終え、既存の記録にも触れない', async (method, path) => {
    const prepare = vi.fn(() => { throw new Error('相談の記録を読んだ'); });
    const app = new Hono<Env>();
    app.route('/', nenMembers);
    const response = await app.request(path, { method }, { DB: { prepare } } as unknown as Env['Bindings']);
    expect(response.status).toBe(404);
    expect(prepare).not.toHaveBeenCalled();
  });
});
