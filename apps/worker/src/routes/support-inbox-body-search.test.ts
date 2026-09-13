import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { supportInbox } from './support-inbox.js';

const NOW = Date.parse('2026-09-13T12:00:00.000Z');
let db: SqliteD1;

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  db = createTestD1();
  db.raw.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-a', 'channel-a', '本店', 'token', 'secret')`).run();
});

afterEach(() => {
  db.raw.close();
  vi.restoreAllMocks();
});

function app(options: { staffId?: string; foreignTenant?: boolean } = {}) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: options.staffId ?? 'reader-a',
      name: '監査担当',
      role: 'owner',
      readOnly: false,
      ...(options.foreignTenant ? { tenantId: 'other-tenant' } : {}),
    });
    await next();
  });
  instance.route('/', supportInbox);
  return instance;
}

type SeedOptions = {
  ageMs?: number;
  assignee?: string | null;
  bodies?: string[];
  customerEmail?: string;
  customerName?: string;
  read?: boolean;
  status?: 'unread' | 'in_progress' | 'on_hold' | 'resolved';
  subject?: string;
};

function seedThread(id: string, options: SeedOptions = {}) {
  const at = new Date(NOW - (options.ageMs ?? 0)).toISOString();
  const subject = options.subject ?? '通常件名';
  db.raw.prepare(`INSERT INTO support_email_threads
    (id, customer_email, customer_name, subject, normalized_subject, status, assigned_staff_id,
     last_message_at, last_incoming_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      id,
      options.customerEmail ?? `${id}@example.test`,
      options.customerName ?? '通常顧客',
      subject,
      subject,
      options.status ?? 'unread',
      options.assignee === undefined ? 'target' : options.assignee,
      at,
      at,
      at,
      at,
    );

  const bodies = options.bodies ?? ['通常本文'];
  bodies.forEach((body, index) => {
    const createdAt = new Date(new Date(at).getTime() - (bodies.length - index - 1) * 1000).toISOString();
    db.raw.prepare(`INSERT INTO support_email_messages
      (id, thread_id, direction, sender_email, recipient_email, subject, body_text, created_at)
      VALUES (?, ?, 'incoming', ?, 'support@example.test', ?, ?, ?)`)
      .run(`message-${id}-${index}`, id, `${id}@example.test`, subject, body, createdAt);
  });

  if (options.read) {
    db.raw.prepare(`INSERT INTO inbox_staff_reads
      (staff_id, channel, conversation_id, last_read_at, updated_at)
      VALUES ('reader-a', 'email', ?, ?, ?)`)
      .run(id, new Date(NOW).toISOString(), new Date(NOW).toISOString());
  }
}

async function request(
  filters: Record<string, string>,
  options: { staffId?: string; foreignTenant?: boolean } = {},
) {
  const query = new URLSearchParams({ channel: 'email', status: 'all', limit: '200', ...filters });
  return app(options).request(`/api/support/inbox?${query}`, {}, { DB: db.db });
}

async function items(filters: Record<string, string>) {
  const response = await request(filters);
  expect(response.status).toBe(200);
  const body = await response.json() as {
    data: { items: Array<{ threadId: string; preview: string }>; summary: { total: number } };
  };
  return body.data;
}

describe('N-017 メール本文検索（実SQLite・実Honoルート）', () => {
  test('最近200件の外でも、最新previewではなく過去本文だけに一致するスレッドを返す', async () => {
    for (let index = 0; index < 200; index += 1) {
      seedThread(`recent-${String(index).padStart(3, '0')}`, { ageMs: index * 1000 });
    }
    seedThread('hidden-body-thread', {
      ageMs: 200_000,
      bodies: ['過去本文だけの検索語 needle', '現在のpreviewには検索語がありません'],
    });

    const firstPage = await items({});
    expect(firstPage.items).toHaveLength(200);
    expect(firstPage.items.map((item) => item.threadId)).not.toContain('hidden-body-thread');

    const searched = await items({ q: 'needle' });
    expect(searched.summary.total).toBe(1);
    expect(searched.items).toEqual([expect.objectContaining({
      threadId: 'hidden-body-thread',
      preview: '現在のpreviewには検索語がありません',
    })]);
  });

  test('メールアドレス・顧客名・件名の従来検索を維持する', async () => {
    seedThread('by-email', { customerEmail: 'mail-key@example.test' });
    seedThread('by-name', { customerName: '名前キー顧客' });
    seedThread('by-subject', { subject: '件名キーの相談' });

    expect((await items({ q: 'mail-key' })).items.map((item) => item.threadId)).toEqual(['by-email']);
    expect((await items({ q: '名前キー' })).items.map((item) => item.threadId)).toEqual(['by-name']);
    expect((await items({ q: '件名キー' })).items.map((item) => item.threadId)).toEqual(['by-subject']);
  });

  test('本文検索をstatus・担当・閲覧者別未読・1時間超過とLIMIT前にANDする', async () => {
    seedThread('match-all', { ageMs: 2 * 3600_000, bodies: ['needle'], assignee: 'target' });
    seedThread('wrong-assignee', { ageMs: 2 * 3600_000, bodies: ['needle'], assignee: 'other' });
    seedThread('already-read', { ageMs: 2 * 3600_000, bodies: ['needle'], assignee: 'target', read: true });
    seedThread('not-overdue', { ageMs: 3599_000, bodies: ['needle'], assignee: 'target' });
    seedThread('resolved', { ageMs: 2 * 3600_000, bodies: ['needle'], assignee: 'target', status: 'resolved' });

    const result = await items({
      q: 'needle',
      assignee: 'target',
      unreadOnly: '1',
      quickFilter: 'overdue',
    });
    expect(result.items.map((item) => item.threadId)).toEqual(['match-all']);
  });

  test('所属外tenantには本文一致を返さない', async () => {
    seedThread('private-body', { bodies: ['needle'] });
    const response = await request({ q: 'needle' }, { staffId: 'foreign-reader', foreignTenant: true });
    expect(response.status).toBe(200);
    expect((await response.json() as { data: { items: unknown[] } }).data.items).toEqual([]);
  });

  test('401件・同時刻の本文一致を上限200とoffsetで欠落重複なく送る', async () => {
    for (let index = 0; index < 401; index += 1) {
      seedThread(`matched-${String(index).padStart(3, '0')}`, { bodies: ['needle'] });
    }

    const pages = await Promise.all([
      items({ q: 'needle', limit: '999' }),
      items({ q: 'needle', limit: '999', offset: '200' }),
      items({ q: 'needle', limit: '999', offset: '400' }),
    ]);
    expect(pages.map((page) => page.items.length)).toEqual([200, 200, 1]);
    expect(pages.every((page) => page.summary.total === 401)).toBe(true);
    const found = pages.flatMap((page) => page.items.map((item) => item.threadId));
    expect(found).toHaveLength(401);
    expect(new Set(found).size).toBe(401);
  });
});
