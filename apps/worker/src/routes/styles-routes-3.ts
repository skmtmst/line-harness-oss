import { requireRole } from '../middleware/role-guard.js';
import { Hono } from 'hono';

import type { Env } from '../worker-env.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';

import {
  StyleError,
  checkStyle,
  profile,
  readDefinition,
} from '../services/style-setup.js';
import { instant } from '../services/style-analytics.js';

import { validRestaurantDate } from '../services/restaurant-booking.js';
import {
  base,
  hq,
  account,
  json,
  edit,
  text,
  version,
} from './styles-common.js';
export const styles = new Hono<Env>();

styles.put(base + '/members/:friendId', async (c) => {
  edit(c, '/events');
  const a = await account(c),
    b = await json(c),
    f = c.req.param('friendId');
  if (
    !(await c.env.DB.prepare(
      'SELECT id FROM friends WHERE id=? AND line_account_id=?',
    )
      .bind(f, a)
      .first())
  )
    throw new StyleError('not_found', 404);
  const m = await c.env.DB.prepare(
    'SELECT version FROM lesson_memberships WHERE line_account_id=? AND friend_id=?',
  )
    .bind(a, f)
    .first<{ version: number }>();
  version(b.expectedVersion, m?.version ?? 0);
  const joined = text(b.joinedAt, 40);
  if (!joined || !Number.isFinite(instant(joined)))
    throw new StyleError('invalid_join_date');
  const ended = text(b.endedAt, 40),
    expires = text(b.expiresAt, 40);
  if (
    (ended &&
      (!Number.isFinite(instant(ended)) || instant(ended) < instant(joined))) ||
    (expires && !Number.isFinite(instant(expires)))
  )
    throw new StyleError('invalid_membership_date');
  if (ended && !text(b.withdrawalReason))
    throw new StyleError('withdrawal_reason_required');
  if (
    b.remainingUses !== undefined &&
    b.remainingUses !== null &&
    (!Number.isInteger(b.remainingUses) || Number(b.remainingUses) < 0)
  )
    throw new StyleError('invalid_uses');
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT json(CASE WHEN COALESCE((SELECT version FROM lesson_memberships WHERE line_account_id=? AND friend_id=?),0)=? THEN '{}' ELSE 'STYLE_VERSION_CONFLICT' END)`,
    ).bind(a, f, m?.version ?? 0),
    c.env.DB.prepare(
      `INSERT INTO lesson_memberships(id,line_account_id,friend_id,plan_name,joined_at,ended_at,withdrawal_reason,expires_at,remaining_uses,updated_by,version,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(line_account_id,friend_id) DO UPDATE SET plan_name=excluded.plan_name,joined_at=excluded.joined_at,ended_at=excluded.ended_at,withdrawal_reason=excluded.withdrawal_reason,expires_at=excluded.expires_at,remaining_uses=excluded.remaining_uses,updated_by=excluded.updated_by,version=excluded.version,updated_at=excluded.updated_at`,
    ).bind(
      crypto.randomUUID(),
      a,
      f,
      text(b.planName, 100),
      joined,
      ended,
      text(b.withdrawalReason),
      expires,
      b.remainingUses ?? null,
      c.get('staff').id,
      (m?.version ?? 0) + 1,
      now,
    ),
    c.env.DB.prepare(
      'INSERT INTO style_change_logs(id,line_account_id,actor_id,action,after_json,created_at) VALUES(?,?,?,?,?,?)',
    ).bind(
      crypto.randomUUID(),
      a,
      c.get('staff').id,
      'membership.save',
      JSON.stringify({
        fields: Object.keys(b),
        version: (m?.version ?? 0) + 1,
      }),
      now,
    ),
  ]);
  return c.json({ success: true, data: { version: (m?.version ?? 0) + 1 } });
});

styles.put(base + '/holidays/:date', async (c) => {
  edit(c);
  const a = await account(c),
    b = await json(c),
    date = c.req.param('date');
  if (!validRestaurantDate(date ?? '') || !text(b.name, 100))
    throw new StyleError('invalid_holiday');
  await c.env.DB.prepare(
    'INSERT INTO style_holidays VALUES(?,?,?) ON CONFLICT(line_account_id,date) DO UPDATE SET name=excluded.name',
  )
    .bind(a, date, text(b.name, 100))
    .run();
  return c.json({ success: true });
});

styles.put(base + '/targets', async (c) => {
  edit(c);
  const a = await account(c),
    b = await json(c);
  if (
    typeof b.metric !== 'string' ||
    !['bookings', 'visits', 'estimatedRevenue', 'conversionRate'].includes(
      b.metric,
    ) ||
    typeof b.period !== 'string' ||
    !/^\d{4}-\d{2}$/.test(b.period) ||
    typeof b.value !== 'number' ||
    !Number.isFinite(b.value) ||
    b.value < 0
  )
    throw new StyleError('invalid_target');
  await c.env.DB.prepare(
    'INSERT INTO style_targets VALUES(?,?,?,?) ON CONFLICT(line_account_id,metric,period) DO UPDATE SET value=excluded.value',
  )
    .bind(a, b.metric, b.period, b.value)
    .run();
  return c.json({ success: true });
});

styles.get(base + '/analytics-settings', async (c) => {
  const a = await account(c);
  return c.json({
    success: true,
    data: {
      holidays: (
        await c.env.DB.prepare(
          'SELECT date,name FROM style_holidays WHERE line_account_id=?',
        )
          .bind(a)
          .all()
      ).results,
      targets: (
        await c.env.DB.prepare(
          'SELECT metric,period,value FROM style_targets WHERE line_account_id=?',
        )
          .bind(a)
          .all()
      ).results,
      pageViews:
        (
          await c.env.DB.prepare(
            'SELECT COUNT(*) count FROM booking_page_views WHERE line_account_id=?',
          )
            .bind(a)
            .first<{ count: number }>()
        )?.count ?? 0,
    },
  });
});

styles.get('/api/hq/style-starter-sets', async (c) => {
  const tenant = await hq(c);
  return c.json({
    success: true,
    data: (
      await c.env.DB.prepare(
        `SELECT s.*, (SELECT name FROM staff_members u WHERE u.id=s.updated_by AND u.tenant_id=s.tenant_id) updatedByName, (SELECT COUNT(*) FROM account_styles p JOIN line_accounts a ON a.id=p.line_account_id WHERE a.tenant_id=s.tenant_id AND a.archived_at IS NULL AND a.is_active=1 AND p.style=s.style AND p.selection_mode='configured' AND p.selected_at IS NOT NULL) accountCount FROM style_starter_sets s WHERE s.tenant_id=? AND s.archived_at IS NULL`,
      )
        .bind(tenant)
        .all<{
          id: string;
          style: string;
          name: string;
          version: number;
          definition_json: string;
          auto_insert: number;
          updated_at: string;
          updated_by: string | null;
          updatedByName: string | null;
          accountCount: number;
        }>()
    ).results.map(
      ({ definition_json, auto_insert, updated_at, updated_by, ...r }) => ({
        ...r,
        autoInsert: !!auto_insert,
        updatedAt: updated_at,
        updatedBy: updated_by,
        definition: JSON.parse(definition_json),
      }),
    ),
  });
});

styles.put(
  '/api/hq/style-starter-sets/:style',
  requireRole('owner', 'admin'),
  async (c) => {
    const tenant = await hq(c),
      style = checkStyle(c.req.param('style')),
      b = await json(c);
    const definition = readDefinition(b.definition, style),
      current = await c.env.DB.prepare(
        'SELECT id,version,auto_insert FROM style_starter_sets WHERE tenant_id=? AND style=? AND archived_at IS NULL',
      )
        .bind(tenant, style)
        .first<{ id: string; version: number; auto_insert: number }>();
    if (b.autoInsert !== undefined && typeof b.autoInsert !== 'boolean')
      throw new StyleError('invalid_auto_insert');
    const autoInsert = b.autoInsert ?? !!(current?.auto_insert ?? 1);
    version(b.expectedVersion, current?.version ?? 0);
    const id = current?.id ?? crypto.randomUUID(),
      now = new Date().toISOString();
    if (current) {
      const r = await c.env.DB.prepare(
        'UPDATE style_starter_sets SET name=?,definition_json=?,version=version+1,updated_at=?,updated_by=?,auto_insert=? WHERE id=? AND tenant_id=? AND version=?',
      )
        .bind(
          text(b.name, 100) ?? style,
          JSON.stringify(definition),
          now,
          c.get('staff').id,
          Number(autoInsert),
          id,
          tenant,
          current.version,
        )
        .run();
      if (!r.meta.changes) throw new StyleError('version_conflict', 409);
    } else
      await c.env.DB.prepare(
        'INSERT INTO style_starter_sets(id,tenant_id,style,name,definition_json,updated_at,updated_by,auto_insert) VALUES(?,?,?,?,?,?,?,?)',
      )
        .bind(
          id,
          tenant,
          style,
          text(b.name, 100) ?? style,
          JSON.stringify(definition),
          now,
          c.get('staff').id,
          Number(autoInsert),
        )
        .run();
    return c.json({
      success: true,
      data: { id, version: (current?.version ?? 0) + 1, autoInsert },
    });
  },
);

styles.get('/api/hq/style-attention', async (c) => {
  await hq(c, true);
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  const items = [];
  for (const account of scope.accounts) {
    const a = account.id,
      queries: Record<string, string> = {
        unhandledChats: `SELECT id,'/chats' href FROM chats WHERE line_account_id=? AND status IN('unread','in_progress','on_hold')`,
        pendingBookings: `SELECT id,'/booking/bookings' href FROM bookings WHERE line_account_id=? AND status='requested' UNION ALL SELECT id,'/events/bookings' href FROM event_bookings WHERE line_account_id=? AND status='requested' UNION ALL SELECT r.id,'/restaurant-test/reservations' href FROM rt_reservations r JOIN rt_stores s ON s.id=r.store_id WHERE s.line_account_id=? AND r.status='pending' AND r.hold_expires_at IS NULL`,
        unpaid: `SELECT id FROM booking_payments WHERE line_account_id=? AND status IN('unpaid','pending','failed')`,
        connections: `SELECT id,'/accounts' href FROM line_account_connection_checks c WHERE line_account_id=? AND result IN('failed','mismatched','unconfigured') AND NOT EXISTS(SELECT 1 FROM line_account_connection_checks n WHERE n.line_account_id=c.line_account_id AND n.check_kind=c.check_kind AND n.checked_at>c.checked_at)`,
        stoppedDeliveries: `SELECT id,'/broadcasts' href FROM broadcasts WHERE line_account_id=? AND status IN('stopped','failed')`,
      };
    const counts: Record<string, number> = {},
      details: Record<string, unknown[]> = {};
    for (const [kind, sql] of Object.entries(queries)) {
      const bindings = Array.from(
        { length: kind === 'pendingBookings' ? 3 : 1 },
        () => a,
      );
      const count = await c.env.DB.prepare(
        `SELECT COUNT(*) count FROM (${sql})`,
      )
        .bind(...bindings)
        .first<{ count: number }>();
      counts[kind] = count?.count ?? 0;
      details[kind] = (
        await c.env.DB.prepare(sql + ' LIMIT 100')
          .bind(...bindings)
          .all()
      ).results;
    }
    items.push({
      accountId: a,
      style: (await profile(c.env.DB, a))?.style ?? 'standard',
      name:
        (
          await c.env.DB.prepare('SELECT name FROM line_accounts WHERE id=?')
            .bind(a)
            .first<{ name: string }>()
        )?.name ?? '',
      counts,
      details,
    });
  }
  return c.json({
    success: true,
    data: { asOf: new Date().toISOString(), items },
  });
});
