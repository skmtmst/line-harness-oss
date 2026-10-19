import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { getActiveImpersonation, revealPiiForImpersonation, startImpersonation, deleteAdminSession, revokeStaffAuthentication } from '@line-crm/db';
import type { Env } from '../worker-env.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { maskPiiDeep, piiMaskMiddleware, toImpersonationContext } from './impersonation.js';
import { sha256Hex } from './auth.js';

let db: SqliteD1;
let id: string;
const person = { id: 'friend-1234', realName: 'fixture-real', systemDisplayName: 'fixture-system', display_name: 'fixture-display',
  customer_name: 'fixture-customer', email: 'fixture@example.com', phone_number: 'fixture-phone', lineUserId: 'fixture-line',
  customer_note: 'fixture-note', internalNote: 'fixture-internal', metadata: { arbitrary: 'fixture-meta', nested: ['fixture-nested'] },
  answers: { value: 'fixture-answer' }, downloadUrl: '/fixture-file', tags: [{ name: 'Public label' }] };
beforeEach(async () => {
  db = createTestD1();
  db.raw.prepare("INSERT INTO staff_members(id,name,role,api_key) VALUES ('operator','Fixture','owner','fixture-key')").run();
  db.raw.prepare("INSERT INTO tenants(id,name) VALUES ('target','Fixture target')").run();
  db.raw.prepare('INSERT INTO admin_sessions(token_hash,staff_id,expires_at) VALUES (?,?,?)').run(await sha256Hex('fixture-session'), 'operator', new Date(Date.now() + 3600000).toISOString());
  id = (await startImpersonation(db.db, { staffId: 'operator', tenantId: 'target', sessionTokenHash: await sha256Hex('fixture-session') })).id;
});
afterEach(() => db.raw.close());
async function reveal() { await revealPiiForImpersonation(db.db, { impersonationSessionId: id, staffId: 'operator', tenantId: 'target', reason: 'fixture support reason' }); }
function app(path: string, format: 'json' | 'csv' | 'file') {
  const a = new Hono<Env>(); a.use('*', async (c, next) => {
    c.set('staff', { id: 'operator', name: 'Fixture', role: 'owner', tenantId: 'target', readOnly: false });
    const active = await getActiveImpersonation(db.db, 'operator');
    if (active) c.set('impersonation', toImpersonationContext(active));
    return next();
  }); a.use('*', piiMaskMiddleware);
  a.get(path, c => format === 'json' ? c.json({ data: person }) : c.body('fixture-sensitive-file', 200, { 'Content-Type': format === 'csv' ? 'text/csv' : 'application/pdf' }));
  return a;
}
function fetch(path: string, format: 'json' | 'csv' | 'file') { return app(path, format).request(path, {}, { DB: db.db } as Env['Bindings']); }

describe('impersonation outputs', () => {
  it.each(['/api/friends', '/api/booking/admin/board', '/api/restaurant-test/bookings', '/api/new-customer-route'])('%s classifies PII independent of URL', async path => {
    const res = await fetch(path, 'json'); expect(res.status).toBe(200);
    const data = (await res.json() as { data: typeof person }).data;
    for (const key of ['realName', 'systemDisplayName', 'display_name', 'customer_name'] as const) expect(data[key]).toBe('友だち#1234');
    expect(JSON.stringify(data)).not.toContain('fixture-'); expect(data.email).toBe('');
    expect(data.tags[0].name).toBe('Public label'); expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });
  it.each(['/api/friends', '/api/booking/admin/board'])('%s reveals only with a reason and records the output', async path => {
    await reveal(); const res = await fetch(path, 'json'); expect((await res.json() as { data: typeof person }).data.realName).toBe('fixture-real');
    expect(db.raw.prepare("SELECT result,tenant_id FROM audit_events WHERE action='impersonation.pii.output'").all()).toEqual([{ result: 'success', tenant_id: 'target' }]);
    expect(db.raw.prepare('SELECT COUNT(*) n FROM pii_reveal_logs WHERE impersonation_session_id=?').get(id)).toEqual({ n: 1 });
  });
  it.each([['/api/booking/admin/bookings.csv', 'csv'], ['/api/form-files/document/content', 'file'], ['/api/unclassified-binary', 'file']] as const)('%s defaults to denial and records it; reason permits the file', async (path, format) => {
    const denied = await fetch(path, format); expect(denied.status).toBe(403);
    expect(await denied.text()).not.toContain('fixture-sensitive-file');
    await reveal(); const permitted = await fetch(path, format); expect(permitted.status).toBe(200);
    expect(await permitted.text()).toBe('fixture-sensitive-file');
    expect(db.raw.prepare("SELECT result FROM audit_events WHERE action='impersonation.pii.output' ORDER BY rowid").all()).toEqual([{ result: 'denied' }, { result: 'success' }]);
  });
  it('the operator console also masks PII while impersonating; its own authority is retained', async () => {
    await reveal();
    const a = new Hono<Env>(); a.use('*', async (c, next) => {
      c.set('staff', { id: 'operator', name: 'Fixture', role: 'owner', tenantId: 'operator-tenant', readOnly: false });
      return next();
    }); a.use('*', piiMaskMiddleware);
    a.get('/api/ops/tenant-contacts', c => c.json({ data: person, originalTenant: c.get('staff').tenantId }));
    const res = await a.request('/api/ops/tenant-contacts', { headers: { Authorization: 'Bearer lh_session:fixture-session' } }, { DB: db.db } as Env['Bindings']);
    const body = await res.json() as { data: typeof person; originalTenant: string };
    expect(body.data.realName).toBe('友だち#1234');
    expect(body.originalTenant).toBe('operator-tenant');
  });
  it('a revealed flag without an actual reason cannot expose PII', async () => {
    db.raw.prepare('UPDATE impersonation_sessions SET pii_revealed=1 WHERE id=?').run(id);
    expect((await getActiveImpersonation(db.db, 'operator'))?.pii_revealed).toBe(0);
    expect((await (await fetch('/api/friends', 'json')).json() as { data: typeof person }).data.realName).toBe('友だち#1234');
  });
  it('unexamined deeply nested subtrees are suppressed rather than returned', () => {
    let data: unknown = { realName: 'fixture-deep' }; for (let n = 0; n < 80; n++) data = { nested: data };
    expect(JSON.stringify(maskPiiDeep(data))).not.toContain('fixture-deep');
  });
  it.each(['logout', 'revoke', 'expire'] as const)('%s ends the associated impersonation', async method => {
    if (method === 'logout') await deleteAdminSession(db.db, await sha256Hex('fixture-session'));
    if (method === 'revoke') await revokeStaffAuthentication(db.db, 'operator');
    if (method === 'expire') db.raw.prepare("UPDATE admin_sessions SET expires_at='2000-01-01T00:00:00Z'").run();
    expect(await getActiveImpersonation(db.db, 'operator')).toBeNull();
    expect((db.raw.prepare('SELECT ended_at FROM impersonation_sessions WHERE id=?').get(id) as { ended_at: string | null }).ended_at).toBeTruthy();
  });
  it('a new login cannot resume impersonation tied to the expired session', async () => {
    db.raw.prepare("DELETE FROM admin_sessions").run();
    db.raw.prepare('INSERT INTO admin_sessions(token_hash,staff_id,expires_at) VALUES (?,?,?)').run(await sha256Hex('new-session'), 'operator', new Date(Date.now()+3600000).toISOString());
    expect(await getActiveImpersonation(db.db, 'operator')).toBeNull();
  });
});
