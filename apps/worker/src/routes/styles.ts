import {
  automationRevisionToken,
  publishAutomationDraft,
} from '../services/automation-drafts.js';
import { accountFeatureIsEnabled } from '../services/feature-enforcement.js';
import { restaurantEffectivelyEnabledForTenant } from '../services/tenant-features.js';
import { Hono, type Context } from 'hono';
import { type IndustryStyle } from '@line-crm/shared';
import { createBookingAvailabilityException, getStaffById } from '@line-crm/db';
import type { Env } from '../index.js';
import {
  canAccessAllLineAccounts,
  getVisibleLineAccountScope,
} from '../services/account-access.js';
import { hasStaffPermission, requireRole } from '../middleware/role-guard.js';
import {
  StyleError,
  checkStyle,
  defaultCards,
  features,
  profile,
  questionKeys,
  readCards,
  readDefinition,
  saveProfile,
  starter,
  styleWarnings,
} from '../services/style-setup.js';
import { instant, styleSnapshot } from '../services/style-analytics.js';
import { validRestaurantDate } from '../services/restaurant-booking.js';

export const styles = new Hono<Env>();
const base = '/api/dashboard/style';
styles.onError((e, c) => {
  if (String(e).includes('style_mode_capacity_full'))
    return c.json({ success: false, code: 'mode_capacity_full' }, 409);
  if (
    String(e).includes('STYLE_VERSION_CONFLICT') ||
    String(e).includes('malformed JSON')
  )
    return c.json({ success: false, code: 'version_conflict' }, 409);
  return c.json(
    {
      success: false,
      code: e instanceof StyleError ? e.code : 'style_unavailable',
      error:
        e instanceof StyleError
          ? e.code
          : '情報を確認できません。再読み込みしてください',
    },
    e instanceof StyleError ? e.status : 503,
  );
});
styles.use(
  '/api/dashboard/style*',
  requireRole('owner', 'admin', 'staff'),
  async (c, next) => {
    if (!['GET', 'HEAD'].includes(c.req.method) && c.get('staff').readOnly)
      throw new StyleError('read_only', 403);
    await next();
  },
);
styles.use('/api/hq/style*', requireRole('owner', 'admin'), async (c, next) => {
  await hq(c, c.req.path === '/api/hq/style-attention');
  await next();
});
async function hq(c: Context<Env>, allowScoped = false) {
  const s = c.get('staff');
  if (!s?.tenantId || (!['GET', 'HEAD'].includes(c.req.method) && s.readOnly))
    throw new StyleError('forbidden', 403);
  const m = await getStaffById(c.env.DB, s.id);
  if (
    !m ||
    !m.is_active ||
    m.tenant_id !== s.tenantId ||
    (m.account_scope === 'accounts' && !allowScoped) ||
    !['owner', 'admin'].includes(m.role) ||
    (!['GET', 'HEAD'].includes(c.req.method) && m.access_level === 'read_only')
  )
    throw new StyleError('forbidden', 403);
  return s.tenantId;
}
async function account(c: Context<Env>) {
  const id = c.req.query('account_id');
  if (!id) throw new StyleError('account_required');
  if (!(await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [id])))
    throw new StyleError('not_found', 404);
  return id;
}
async function json(c: Context<Env>): Promise<Record<string, unknown>> {
  if (Number(c.req.header('content-length') ?? 0) > 100000)
    throw new StyleError('request_too_large');
  const t = await c.req.text();
  if (t.length > 100000) throw new StyleError('request_too_large');
  try {
    const b = JSON.parse(t);
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw 0;
    return b;
  } catch {
    throw new StyleError('invalid_json');
  }
}
function edit(c: Context<Env>, permission?: string) {
  const s = c.get('staff');
  if (
    !s ||
    s.readOnly ||
    (permission
      ? !hasStaffPermission(c, permission)
      : !['owner', 'admin'].includes(s.role))
  )
    throw new StyleError('forbidden', 403);
}
function text(v: unknown, max = 1000): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string' || v.length > max)
    throw new StyleError('invalid_text');
  return v.trim() || null;
}
function oneOf(v: unknown, values: string[], nullable = false) {
  if (nullable && (v === null || v === undefined)) return null;
  if (typeof v !== 'string' || !values.includes(v))
    throw new StyleError('invalid_choice');
  return v;
}
function version(v: unknown, current: number) {
  if (!Number.isInteger(v) || v !== current)
    throw new StyleError('version_conflict', 409);
}
async function staffFilter(c: Context<Env>, id: string, style: IndustryStyle) {
  const selected = c.req.query('staff_id');
  const s = c.get('staff');
  if (s.role === 'staff' && style === 'consult') {
    const own = await c.env.DB.prepare(
      'SELECT id FROM staff WHERE line_account_id=? AND staff_member_id=? AND is_active=1',
    )
      .bind(id, s.id)
      .first<{ id: string }>();
    if (!own || (selected && selected !== own.id))
      throw new StyleError('forbidden', 403);
    return own.id;
  }
  if (
    selected &&
    !(await c.env.DB.prepare(
      'SELECT id FROM staff WHERE id=? AND line_account_id=? AND is_active=1',
    )
      .bind(selected, id)
      .first())
  )
    throw new StyleError('staff_not_found', 404);
  return selected;
}
styles.get(base, async (c) => {
  const id = await account(c),
    p = await profile(c.env.DB, id),
    style = p?.style ?? 'standard';
  return c.json({
    success: true,
    data: {
      style,
      styleSelected: !!p?.selected_at,
      version: p?.version ?? 0,
      answers: JSON.parse(p?.answers_json ?? '{}'),
      settings: JSON.parse(p?.settings_json ?? '{}'),
      cards: p?.cards_json ? JSON.parse(p.cards_json) : defaultCards(style),
      questions: questionKeys.map((key) => ({
        key,
        changeAt: features[key],
        canChangeLater: true,
        recommended: key === 'payment' ? false : true,
        modes: ['configured', 'later', 'manual'],
      })),
      warnings: await styleWarnings(c.env.DB, id),
    },
  });
});
styles.put(base, async (c) => {
  edit(c);
  const id = await account(c);
  return c.json({
    success: true,
    data: await saveProfile(
      c.env.DB,
      id,
      c.get('staff').tenantId ?? null,
      c.get('staff').id,
      await json(c),
    ),
  });
});
styles.get(base + '/warnings', async (c) =>
  c.json({
    success: true,
    data: await styleWarnings(c.env.DB, await account(c)),
  }),
);
styles.get(base + '/starter-set', async (c) => {
  await account(c);
  const style = checkStyle(c.req.query('style'));
  return c.json({
    success: true,
    data: await starter(c.env.DB, c.get('staff').tenantId ?? null, style),
  });
});
styles.get(base + '/resources', requireRole('owner', 'admin'), async (c) => {
  const id = await account(c);
  const resources: Array<{ id: string; name: string; kind: string }> = [];
  for (const [kind, table, column] of [
    ['template', 'templates', 'line_account_id'],
    ['rich_menu', 'rich_menu_groups', 'account_id'],
    ['automation', 'automation_definitions', 'line_account_id'],
    ['booking_menu', 'menus', 'line_account_id'],
  ] as const) {
    const rows = (
      await c.env.DB.prepare(
        `SELECT id,name FROM ${table} WHERE ${column}=? ORDER BY name LIMIT 500`,
      )
        .bind(id)
        .all<{ id: string; name: string }>()
    ).results;
    resources.push(...rows.map((r) => ({ ...r, kind })));
  }
  const images = (
    await c.env.DB.prepare(
      `SELECT p.id,p.name FROM rich_menu_pages p JOIN rich_menu_groups g ON g.id=p.group_id WHERE g.account_id=? AND p.image_r2_key IS NOT NULL LIMIT 500`,
    )
      .bind(id)
      .all<{ id: string; name: string }>()
  ).results;
  resources.push(
    ...images.map((r) => ({
      ...r,
      kind: 'image',
    })),
  );
  return c.json({ success: true, data: { items: resources } });
});
styles.put(base + '/cards', async (c) => {
  edit(c);
  const id = await account(c),
    p = await profile(c.env.DB, id);
  if (!p) throw new StyleError('select_style_first', 409);
  const b = await json(c);
  version(b.expectedVersion, p.version);
  const cards = readCards(b.cards, p.style);
  const result = await c.env.DB.prepare(
    'UPDATE account_styles SET cards_json=?,version=version+1,updated_at=?,updated_by=? WHERE line_account_id=? AND version=?',
  )
    .bind(
      JSON.stringify(cards),
      new Date().toISOString(),
      c.get('staff').id,
      id,
      p.version,
    )
    .run();
  if (!result.meta.changes) throw new StyleError('version_conflict', 409);
  return c.json({ success: true, data: { cards, version: p.version + 1 } });
});
styles.delete(base + '/cards', async (c) => {
  edit(c);
  const id = await account(c),
    p = await profile(c.env.DB, id),
    b = await json(c);
  if (!p) throw new StyleError('select_style_first', 409);
  version(b.expectedVersion, p.version);
  const r = await c.env.DB.prepare(
    'UPDATE account_styles SET cards_json=NULL,version=version+1 WHERE line_account_id=? AND version=?',
  )
    .bind(id, p.version)
    .run();
  if (!r.meta.changes) throw new StyleError('version_conflict', 409);
  return c.json({
    success: true,
    data: { cards: defaultCards(p.style), version: p.version + 1 },
  });
});
for (const path of ['/summary', '/analytics', '/bookings', '/people'])
  styles.get(base + path, async (c) => {
    const id = await account(c),
      p = await profile(c.env.DB, id),
      style = checkStyle(c.req.query('style') ?? p?.style);
    if (style === 'standard' || style === 'ec')
      throw new StyleError('industry_required');
    if (
      style === 'restaurant' &&
      !(await restaurantEffectivelyEnabledForTenant(c))
    )
      throw new StyleError('not_found', 404);
    if (
      style !== 'restaurant' &&
      !(await accountFeatureIsEnabled(
        c.env.DB,
        id,
        style === 'lesson' ? 'events' : 'booking',
      ))
    )
      throw new StyleError('feature_disabled', 403);
    const permission = style === 'lesson' ? '/events' : '/booking/bookings';
    if (style !== 'restaurant' && !hasStaffPermission(c, permission))
      throw new StyleError('forbidden', 403);
    const data = await styleSnapshot(
      c.env.DB,
      id,
      style,
      c.req.query(),
      await staffFilter(c, id, style),
    );
    return c.json({ success: true, data });
  });

/** API used by the existing analytics result-to-audience route. No messages are sent. */
export async function bookingAudience(
  c: Context<Env>,
  id: string,
  body: Record<string, unknown>,
  accountId: string,
) {
  const result = await c.env.DB.prepare(
    'SELECT selection_json,expires_at FROM style_analytics_results WHERE id=? AND line_account_id=?',
  )
    .bind(id, accountId)
    .first<{ selection_json: string; expires_at: string }>();
  if (!result || instant(result.expires_at) <= Date.now())
    throw new StyleError('result_not_found', 404);
  const selected = JSON.parse(result.selection_json) as {
    ids: Array<{ friendId: string | null; personKey: string }>;
  };
  const requested = body.friendIds;
  if (
    requested !== undefined &&
    (!Array.isArray(requested) ||
      requested.some(
        (v) =>
          typeof v !== 'string' || !selected.ids.some((r) => r.friendId === v),
      ))
  )
    throw new StyleError('invalid_selection', 422);
  const people = new Set(
    selected.ids.filter((r) => !r.friendId).map((r) => r.personKey),
  );
  const ids = [
    ...new Set(
      selected.ids
        .map((r) => r.friendId)
        .filter(
          (v): v is string =>
            !!v &&
            (requested === undefined || (requested as string[]).includes(v)),
        ),
    ),
  ];
  const audienceId = crypto.randomUUID(),
    now = new Date().toISOString(),
    expiresAt = new Date(Date.now() + 86400000).toISOString();
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO analytics_result_audiences(id,line_account_id,source_kind,source_result_id,selection_key,member_count,expires_at,created_by,created_at) VALUES(?,?,'booking',?,'selection',0,?,?,?)`,
    ).bind(audienceId, accountId, id, expiresAt, c.get('staff').id, now),
  ];
  for (const friendId of ids)
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO analytics_result_audience_members(audience_id,friend_id) SELECT ?,id FROM friends WHERE id=? AND line_account_id=? AND is_following=1 AND is_hidden=0`,
      ).bind(audienceId, friendId, accountId),
    );
  statements.push(
    c.env.DB.prepare(
      'UPDATE analytics_result_audiences SET member_count=(SELECT COUNT(*) FROM analytics_result_audience_members WHERE audience_id=?) WHERE id=?',
    ).bind(audienceId, audienceId),
  );
  await c.env.DB.batch(statements);
  const count = (await c.env.DB.prepare(
    'SELECT member_count FROM analytics_result_audiences WHERE id=?',
  )
    .bind(audienceId)
    .first<{ member_count: number }>())!.member_count;
  return {
    id: audienceId,
    memberCount: count,
    unreachableCount: people.size + ids.length - count,
    expiresAt,
  };
}
styles.post(base + '/results/:id/audiences', async (c) => {
  edit(c);
  const id = await account(c);
  return c.json(
    {
      success: true,
      data: await bookingAudience(
        c,
        c.req.param('id') ?? '',
        await json(c),
        id,
      ),
    },
    201,
  );
});

styles.patch(base + '/menus/:id', async (c) => {
  edit(c, '/booking/menus');
  const a = await account(c),
    b = await json(c);
  const r = await c.env.DB.prepare(
    'SELECT version FROM menus WHERE id=? AND line_account_id=?',
  )
    .bind(c.req.param('id'), a)
    .first<{ version: number }>();
  if (!r) throw new StyleError('not_found', 404);
  version(b.expectedVersion, r.version);
  const mode = oneOf(b.meetingMode, ['online', 'in_person', 'customer_choice']);
  const result = await c.env.DB.prepare(
    'UPDATE menus SET meeting_mode=?,meeting_location=?,version=version+1 WHERE id=? AND line_account_id=? AND version=?',
  )
    .bind(mode, text(b.location), c.req.param('id'), a, r.version)
    .run();
  if (!result.meta.changes) throw new StyleError('version_conflict', 409);
  return c.json({
    success: true,
    data: {
      version: r.version + 1,
      meetingMode: mode,
      location: text(b.location),
    },
  });
});
styles.patch(base + '/bookings/:id', async (c) => {
  edit(c, '/booking/bookings');
  const a = await account(c),
    b = await json(c),
    id = c.req.param('id');
  const r = await c.env.DB.prepare(
    'SELECT * FROM bookings WHERE id=? AND line_account_id=?',
  )
    .bind(id, a)
    .first<Record<string, string | number | null>>();
  if (!r) throw new StyleError('not_found', 404);
  version(b.expectedVersion, Number(r.lock_version));
  if (c.get('staff').role === 'staff') {
    const own = await c.env.DB.prepare(
      'SELECT id FROM staff WHERE id=? AND staff_member_id=?',
    )
      .bind(r.staff_id, c.get('staff').id)
      .first();
    if (!own) throw new StyleError('forbidden', 403);
  }
  const mode =
      b.meetingMode === undefined
        ? r.meeting_mode
        : oneOf(b.meetingMode, ['online', 'in_person'], true),
    url = b.meetingUrl === undefined ? r.meeting_url : text(b.meetingUrl, 2000);
  if (url) {
    let u: URL;
    try {
      u = new URL(String(url));
    } catch {
      throw new StyleError('invalid_meeting_url');
    }
    if (u.protocol !== 'https:' || u.username || u.password)
      throw new StyleError('invalid_meeting_url');
  }
  if (
    b.meetingUrl !== undefined &&
    url &&
    new URL(String(url)).hostname === 'meet.google.com'
  ) {
    const registered = await c.env.DB.prepare(
      `SELECT m.id FROM meet_consultations m WHERE m.booking_id=? AND m.friend_id=? AND m.meet_url=? AND m.status='confirmed' AND julianday(m.starts_at)=julianday(?) AND julianday(m.ends_at)=julianday(?) AND EXISTS(SELECT 1 FROM meet_consultation_reminders r WHERE r.consultation_id=m.id AND r.kind='day_before') AND EXISTS(SELECT 1 FROM meet_consultation_reminders r WHERE r.consultation_id=m.id AND r.kind='hour_before')`,
    )
      .bind(id, r.friend_id, url, r.starts_at, r.ends_at)
      .first();
    if (!registered)
      throw new StyleError('register_meet_consultation_first', 422);
  }
  const outcome =
      b.outcome === undefined
        ? r.consultation_outcome
        : oneOf(b.outcome, ['considering', 'won', 'lost'], true),
    now = new Date().toISOString();
  const update = c.env.DB.prepare(
    `UPDATE bookings SET meeting_mode=?,meeting_url=?,meeting_location=?,consultation_outcome=?,outcome_recorded_at=?,outcome_recorded_by=?,cancellation_reason=?,designation=?,entry_point=?,lock_version=lock_version+1,updated_at=? WHERE id=? AND line_account_id=? AND lock_version=?`,
  ).bind(
    mode,
    url,
    b.location === undefined ? r.meeting_location : text(b.location),
    outcome,
    b.outcome === undefined ? r.outcome_recorded_at : now,
    b.outcome === undefined ? r.outcome_recorded_by : c.get('staff').id,
    b.cancellationReason === undefined
      ? r.cancellation_reason
      : text(b.cancellationReason),
    b.designation === undefined
      ? r.designation
      : oneOf(b.designation, ['designated', 'any', 'unspecified']),
    b.entryPoint === undefined ? r.entry_point : text(b.entryPoint, 100),
    now,
    id,
    a,
    r.lock_version,
  );
  await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT json(CASE WHEN EXISTS(SELECT 1 FROM bookings WHERE id=? AND line_account_id=? AND lock_version=?) THEN '{}' ELSE 'STYLE_VERSION_CONFLICT' END)`,
    ).bind(id, a, r.lock_version),
    update,
    c.env.DB.prepare(
      'UPDATE meet_consultations SET booking_version=? WHERE booking_id=? AND booking_version=?',
    ).bind(Number(r.lock_version) + 1, id, r.lock_version),
    c.env.DB.prepare(
      'INSERT INTO style_change_logs(id,line_account_id,actor_id,action,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?)',
    ).bind(
      crypto.randomUUID(),
      a,
      c.get('staff').id,
      'booking.details',
      JSON.stringify({
        id,
        version: r.lock_version,
        outcome: r.consultation_outcome,
      }),
      JSON.stringify({ id, outcome, fields: Object.keys(b) }),
      now,
    ),
  ]);
  return c.json({
    success: true,
    data: { id, version: Number(r.lock_version) + 1 },
  });
});
styles.patch(base + '/classes/:id', async (c) => {
  edit(c, '/events');
  const a = await account(c),
    b = await json(c);
  const s = await c.env.DB.prepare(
    'SELECT s.* FROM event_slots s JOIN events e ON e.id=s.event_id WHERE s.id=? AND e.line_account_id=?',
  )
    .bind(c.req.param('id'), a)
    .first<{
      id: string;
      version: number;
      capacity: number | null;
      classroom_capacity: number | null;
      online_capacity: number | null;
      instructor_id: string | null;
    }>();
  if (!s) throw new StyleError('not_found', 404);
  version(b.expectedVersion, s.version);
  const capacity = (v: unknown) => {
    if (
      v !== null &&
      (!Number.isInteger(v) || Number(v) < 0 || Number(v) > 100000)
    )
      throw new StyleError('invalid_capacity');
    return v as number | null;
  };
  const classroom =
      b.classroomCapacity === undefined
        ? s.classroom_capacity
        : capacity(b.classroomCapacity),
    online =
      b.onlineCapacity === undefined
        ? s.online_capacity
        : capacity(b.onlineCapacity),
    instructor =
      b.instructorId === undefined
        ? s.instructor_id
        : text(b.instructorId, 100);
  if (
    instructor &&
    !(await c.env.DB.prepare(
      'SELECT id FROM staff WHERE id=? AND line_account_id=? AND is_active=1',
    )
      .bind(instructor, a)
      .first())
  )
    throw new StyleError('instructor_not_found', 404);
  const total =
    classroom === null && online === null
      ? s.capacity
      : classroom === null || online === null
        ? null
        : classroom + online;
  const changed = await c.env.DB.prepare(
    'UPDATE event_slots SET classroom_capacity=?,online_capacity=?,capacity=?,instructor_id=?,version=version+1 WHERE id=? AND version=?',
  )
    .bind(classroom, online, total, instructor, s.id, s.version)
    .run();
  if (!changed.meta.changes) throw new StyleError('version_conflict', 409);
  return c.json({
    success: true,
    data: {
      id: s.id,
      version: s.version + 1,
      classroomCapacity: classroom,
      onlineCapacity: online,
      instructorId: instructor,
    },
  });
});
styles.patch(base + '/events/:id', async (c) => {
  edit(c, '/events');
  const a = await account(c),
    b = await json(c);
  if (typeof b.isTrial !== 'boolean') throw new StyleError('invalid_trial');
  const r = await c.env.DB.prepare(
    'UPDATE events SET is_trial=?,version=version+1 WHERE id=? AND line_account_id=? AND version=?',
  )
    .bind(Number(b.isTrial), c.req.param('id'), a, b.expectedVersion)
    .run();
  if (!r.meta.changes) throw new StyleError('version_conflict', 409);
  return c.json({ success: true });
});
styles.patch(base + '/event-bookings/:id', async (c) => {
  edit(c, '/events');
  const a = await account(c),
    b = await json(c),
    mode = oneOf(b.participationMode, ['classroom', 'online']);
  const r = await c.env.DB.prepare(
    'UPDATE event_bookings SET participation_mode=? WHERE id=? AND line_account_id=?',
  )
    .bind(mode, c.req.param('id'), a)
    .run();
  if (!r.meta.changes) throw new StyleError('not_found', 404);
  return c.json({ success: true, data: { participationMode: mode } });
});
styles.patch(base + '/event-waitlist/:id', async (c) => {
  edit(c, '/events');
  const a = await account(c),
    b = await json(c),
    mode = oneOf(b.participationMode, ['classroom', 'online']);
  const r = await c.env.DB.prepare(
    'UPDATE event_waitlist SET participation_mode=?,version=version+1 WHERE id=? AND line_account_id=? AND version=?',
  )
    .bind(mode, c.req.param('id'), a, b.expectedVersion)
    .run();
  if (!r.meta.changes) throw new StyleError('version_conflict', 409);
  return c.json({ success: true, data: { participationMode: mode } });
});
styles.get(base + '/members', async (c) => {
  const a = await account(c);
  if (!hasStaffPermission(c, '/events')) throw new StyleError('forbidden', 403);
  return c.json({
    success: true,
    data: (
      await c.env.DB.prepare(
        'SELECT m.* FROM lesson_memberships m JOIN friends f ON f.id=m.friend_id AND f.line_account_id=m.line_account_id WHERE m.line_account_id=?',
      )
        .bind(a)
        .all()
    ).results,
  });
});
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
        'SELECT * FROM style_starter_sets WHERE tenant_id=? AND archived_at IS NULL',
      )
        .bind(tenant)
        .all<{
          id: string;
          style: string;
          name: string;
          version: number;
          definition_json: string;
        }>()
    ).results.map(({ definition_json, ...r }) => ({
      ...r,
      definition: JSON.parse(definition_json),
    })),
  });
});
styles.put('/api/hq/style-starter-sets/:style', async (c) => {
  const tenant = await hq(c),
    style = checkStyle(c.req.param('style')),
    b = await json(c);
  const definition = readDefinition(b.definition, style),
    current = await c.env.DB.prepare(
      'SELECT id,version FROM style_starter_sets WHERE tenant_id=? AND style=? AND archived_at IS NULL',
    )
      .bind(tenant, style)
      .first<{ id: string; version: number }>();
  version(b.expectedVersion, current?.version ?? 0);
  const id = current?.id ?? crypto.randomUUID(),
    now = new Date().toISOString();
  if (current) {
    const r = await c.env.DB.prepare(
      'UPDATE style_starter_sets SET name=?,definition_json=?,version=version+1,updated_at=?,updated_by=? WHERE id=? AND tenant_id=? AND version=?',
    )
      .bind(
        text(b.name, 100) ?? style,
        JSON.stringify(definition),
        now,
        c.get('staff').id,
        id,
        tenant,
        current.version,
      )
      .run();
    if (!r.meta.changes) throw new StyleError('version_conflict', 409);
  } else
    await c.env.DB.prepare(
      'INSERT INTO style_starter_sets(id,tenant_id,style,name,definition_json,updated_at,updated_by) VALUES(?,?,?,?,?,?,?)',
    )
      .bind(
        id,
        tenant,
        style,
        text(b.name, 100) ?? style,
        JSON.stringify(definition),
        now,
        c.get('staff').id,
      )
      .run();
  return c.json({
    success: true,
    data: { id, version: (current?.version ?? 0) + 1 },
  });
});
styles.get('/api/hq/style-attention', async (c) => {
  await hq(c, true);
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  const items = [];
  for (const account of scope.accounts) {
    const a = account.id,
      queries: Record<string, string> = {
        unhandledChats: `SELECT id,'/chats' href FROM chats WHERE line_account_id=? AND status IN('unread','in_progress','on_hold')`,
        pendingBookings: `SELECT id,'/booking/bookings' href FROM bookings WHERE line_account_id=? AND status='requested' UNION ALL SELECT id,'/events' href FROM event_bookings WHERE line_account_id=? AND status='requested' UNION ALL SELECT r.id,'/restaurant-test' href FROM rt_reservations r JOIN rt_stores s ON s.id=r.store_id WHERE s.line_account_id=? AND r.status='pending' AND r.hold_expires_at IS NULL`,
        unpaid: `SELECT id,'/booking/settings?tab=payment' href FROM booking_payments WHERE line_account_id=? AND status IN('unpaid','pending','failed')`,
        connections: `SELECT id,'/line-accounts' href FROM line_account_connection_checks c WHERE line_account_id=? AND result IN('failed','mismatched','unconfigured') AND NOT EXISTS(SELECT 1 FROM line_account_connection_checks n WHERE n.line_account_id=c.line_account_id AND n.check_kind=c.check_kind AND n.checked_at>c.checked_at)`,
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

// Reuse availability exceptions: these writes never cancel existing reservations.
styles.post(base + '/closures', async (c) => {
  edit(c, 'booking.settings');
  const a = await account(c),
    b = await json(c);
  const date = text(b.date, 10),
    target = oneOf(b.target, ['store', 'staff']);
  if (!date || !validRestaurantDate(date)) throw new StyleError('invalid_date');
  const start = text(b.startTime, 5),
    end = text(b.endTime, 5),
    allDay = b.allDay === true;
  if (
    !allDay &&
    (!start ||
      !end ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) ||
      start >= end)
  )
    throw new StyleError('invalid_time');
  const scopeId = target === 'staff' ? text(b.staffId, 100) : null;
  if (target === 'staff' && !scopeId) throw new StyleError('staff_required');
  let open: Array<{ start: string; end: string }> = [];
  if (!allDay) {
    const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
    if (target === 'store')
      open = (
        await c.env.DB.prepare(
          `SELECT h.start_time start,h.end_time end FROM booking_business_hours h JOIN booking_settings s ON s.id=h.booking_settings_id WHERE s.line_account_id=? AND h.weekday=?`,
        )
          .bind(a, weekday)
          .all<{ start: string; end: string }>()
      ).results;
    else {
      const shifts = (
        await c.env.DB.prepare(
          `SELECT sh.start_time start,sh.end_time end FROM staff_shifts sh JOIN staff s ON s.id=sh.staff_id WHERE s.line_account_id=? AND s.id=? AND sh.work_date=?`,
        )
          .bind(a, scopeId, date)
          .all<{ start: string; end: string }>()
      ).results;
      open = shifts.length
        ? shifts
        : (
            await c.env.DB.prepare(
              `SELECT r.start_time start,r.end_time end FROM staff_availability_rules r JOIN staff s ON s.id=r.staff_id WHERE s.line_account_id=? AND s.id=? AND r.weekday=? AND r.is_active=1`,
            )
              .bind(a, scopeId, weekday)
              .all<{ start: string; end: string }>()
          ).results;
    }
    const existing = (
      await c.env.DB.prepare(
        "SELECT scope_kind,scope_id,kind,hours_json FROM booking_availability_exceptions WHERE line_account_id=? AND date_from<=? AND date_to>=? AND (scope_kind='store' OR (scope_kind=? AND scope_id IS ?)) ORDER BY created_at,id",
      )
        .bind(a, date, date, target, scopeId)
        .all<{
          kind: string;
          hours_json: string;
          scope_kind: string;
          scope_id: string | null;
        }>()
    ).results;
    if (existing.length)
      throw new StyleError('existing_exception_use_edit', 409);
    if (!open.length) throw new StyleError('working_hours_unconfigured', 422);
    open = open.flatMap((i) => {
      if (i.end <= start! || i.start >= end!) return [i];
      return [
        ...(i.start < start! ? [{ start: i.start, end: start! }] : []),
        ...(i.end > end! ? [{ start: end!, end: i.end }] : []),
      ];
    });
  }
  const item = await createBookingAvailabilityException(c.env.DB, {
    lineAccountId: a,
    scopeKind: target as 'store' | 'staff',
    scopeId,
    dateFrom: date,
    dateTo: date,
    kind: allDay || !open.length ? 'closed' : 'custom_hours',
    intervals: allDay ? [] : open,
    reason: text(b.reason),
  });
  if (!item) throw new StyleError('scope_not_found', 404);
  return c.json(
    {
      success: true,
      data: { exception: item, existingReservationsCancelled: false },
    },
    201,
  );
});

styles.patch(base + '/meet/:id', async (c) => {
  edit(c, '/booking/bookings');
  const a = await account(c),
    b = await json(c),
    id = c.req.param('id');
  const r = await c.env.DB.prepare(
    'SELECT m.* FROM meet_consultations m JOIN friends f ON f.id=m.friend_id WHERE m.id=? AND f.line_account_id=?',
  )
    .bind(id, a)
    .first<Record<string, string | null>>();
  if (!r) throw new StyleError('not_found', 404);
  if (b.expectedUpdatedAt !== r.updated_at)
    throw new StyleError('version_conflict', 409);
  if (
    c.get('staff').role === 'staff' &&
    !(await c.env.DB.prepare(
      'SELECT id FROM staff WHERE id=? AND staff_member_id=? AND line_account_id=?',
    )
      .bind(r.staff_id, c.get('staff').id, a)
      .first())
  )
    throw new StyleError('forbidden', 403);
  const staffId = b.staffId === undefined ? r.staff_id : text(b.staffId, 100);
  if (
    staffId &&
    !(await c.env.DB.prepare(
      'SELECT id FROM staff WHERE id=? AND line_account_id=? AND is_active=1',
    )
      .bind(staffId, a)
      .first())
  )
    throw new StyleError('staff_not_found', 404);
  const outcome =
      b.outcome === undefined
        ? r.consultation_outcome
        : oneOf(b.outcome, ['considering', 'won', 'lost'], true),
    attendance =
      b.attendance === undefined
        ? r.attendance
        : oneOf(b.attendance, ['visited', 'late', 'no_show'], true),
    now = new Date().toISOString();
  const changed = await c.env.DB.prepare(
    'UPDATE meet_consultations SET staff_id=?,attendance=?,consultation_outcome=?,outcome_recorded_at=?,outcome_recorded_by=?,updated_at=? WHERE id=? AND updated_at=?',
  )
    .bind(
      staffId,
      attendance,
      outcome,
      b.outcome === undefined ? r.outcome_recorded_at : now,
      b.outcome === undefined ? r.outcome_recorded_by : c.get('staff').id,
      now,
      id,
      r.updated_at,
    )
    .run();
  if (!changed.meta.changes) throw new StyleError('version_conflict', 409);
  return c.json({ success: true, data: { id, updatedAt: now } });
});

styles.get(base + '/starter-items', async (c) => {
  const a = await account(c);
  const rows = (
    await c.env.DB.prepare(
      'SELECT * FROM style_starter_items WHERE line_account_id=? ORDER BY applied_at,item_key',
    )
      .bind(a)
      .all<Record<string, unknown>>()
  ).results;
  const items = [];
  for (const item of rows) {
    let status: unknown = null,
      draftRevision: string | null = null;
    if (item.kind === 'automation') {
      const row = await c.env.DB.prepare(
        `SELECT d.status,d.current_draft_version_id,v.trigger_type,v.trigger_config,v.condition_config,v.action_config FROM automation_definitions d LEFT JOIN automation_versions v ON v.id=d.current_draft_version_id WHERE d.id=? AND d.line_account_id=?`,
      )
        .bind(item.target_id, a)
        .first<{
          status: string;
          current_draft_version_id: string | null;
          trigger_type: string;
          trigger_config: string;
          condition_config: string;
          action_config: string;
        }>();
      status = row?.status ?? 'missing';
      if (row?.current_draft_version_id)
        draftRevision = await automationRevisionToken(
          row.current_draft_version_id,
          row,
        );
    } else if (item.kind === 'booking_menu')
      status = (
        await c.env.DB.prepare(
          'SELECT is_active FROM menus WHERE id=? AND line_account_id=?',
        )
          .bind(item.target_id, a)
          .first<{ is_active: number }>()
      )?.is_active
        ? 'active'
        : 'stopped';
    else if (item.kind === 'rich_menu')
      status =
        (
          await c.env.DB.prepare(
            'SELECT status FROM rich_menu_groups WHERE id=? AND account_id=?',
          )
            .bind(item.target_id, a)
            .first<{ status: string }>()
        )?.status ?? 'missing';
    items.push({ ...item, status, draftRevision });
  }
  return c.json({ success: true, data: { items } });
});
styles.post(base + '/activate', async (c) => {
  edit(c);
  const a = await account(c),
    b = await json(c);
  if (
    b.confirmed !== true ||
    !Array.isArray(b.items) ||
    !b.items.length ||
    b.items.length > 30
  )
    throw new StyleError('confirmation_required');
  const seen = new Set<string>();
  for (const item of b.items) {
    if (
      !item ||
      typeof item.id !== 'string' ||
      seen.has(item.id) ||
      !['automation', 'booking_menu'].includes(item.kind)
    )
      throw new StyleError('invalid_activation');
    seen.add(item.id);
    if (
      !(await c.env.DB.prepare(
        'SELECT 1 FROM style_starter_items WHERE line_account_id=? AND target_id=? AND kind=? AND is_sample=1',
      )
        .bind(a, item.id, item.kind)
        .first())
    )
      throw new StyleError('not_found', 404);
  }
  const items = [];
  for (const item of b.items) {
    try {
      if (item.kind === 'automation') {
        if (!hasStaffPermission(c, '/automations'))
          throw new StyleError('forbidden', 403);
        const p = await profile(c.env.DB, a);
        const answer = JSON.parse(p?.answers_json ?? '{}').reminders;
        if (answer?.mode !== 'configured' || answer.value === false)
          throw new StyleError('feature_unconfigured', 422);
        const activated = await publishAutomationDraft(c.env.DB, {
          id: item.id,
          lineAccountId: a,
          expectedDraftVersionId: item.expectedDraftVersionId,
          activate: true,
          expectedStatus: 'draft',
        });
        items.push({ id: item.id, success: true, status: activated.status });
      } else {
        const setup = await profile(c.env.DB, a);
        const answer = JSON.parse(setup?.answers_json ?? '{}').booking;
        if (answer?.mode !== 'configured' || answer.value === false)
          throw new StyleError('feature_unconfigured', 422);
        if (!hasStaffPermission(c, '/booking/menus'))
          throw new StyleError('forbidden', 403);
        const r = await c.env.DB.prepare(
          'UPDATE menus SET is_active=1,version=version+1 WHERE id=? AND line_account_id=? AND version=?',
        )
          .bind(item.id, a, item.expectedVersion)
          .run();
        if (!r.meta.changes) throw new StyleError('version_conflict', 409);
        items.push({ id: item.id, success: true, status: 'active' });
      }
    } catch (e) {
      items.push({
        id: item.id,
        success: false,
        code: e instanceof StyleError ? e.code : 'activation_failed',
      });
    }
  }
  return c.json({
    success: true,
    data: { complete: items.every((i) => i.success), items },
  });
});

styles.get(base + '/menus/:id', async (c) => {
  const a = await account(c);
  if (!hasStaffPermission(c, '/booking/menus'))
    throw new StyleError('forbidden', 403);
  const item = await c.env.DB.prepare(
    'SELECT id,name,version,meeting_mode meetingMode,meeting_location location,is_active isActive FROM menus WHERE id=? AND line_account_id=?',
  )
    .bind(c.req.param('id'), a)
    .first();
  if (!item) throw new StyleError('not_found', 404);
  return c.json({ success: true, data: item });
});
styles.get(base + '/bookings/:id', async (c) => {
  const a = await account(c);
  if (!hasStaffPermission(c, '/booking/bookings'))
    throw new StyleError('forbidden', 403);
  const item = await c.env.DB.prepare(
    'SELECT id,staff_id staffId,lock_version version,meeting_mode meetingMode,meeting_url meetingUrl,meeting_location location,consultation_outcome outcome,outcome_recorded_at outcomeRecordedAt,outcome_recorded_by outcomeRecordedBy,cancellation_reason cancellationReason,designation,entry_point entryPoint FROM bookings WHERE id=? AND line_account_id=?',
  )
    .bind(c.req.param('id'), a)
    .first<{ staffId: string }>();
  if (!item) throw new StyleError('not_found', 404);
  if (
    c.get('staff').role === 'staff' &&
    !(await c.env.DB.prepare(
      'SELECT id FROM staff WHERE id=? AND staff_member_id=?',
    )
      .bind(item.staffId, c.get('staff').id)
      .first())
  )
    throw new StyleError('forbidden', 403);
  return c.json({ success: true, data: item });
});
styles.get(base + '/classes/:id', async (c) => {
  const a = await account(c);
  if (!hasStaffPermission(c, '/events')) throw new StyleError('forbidden', 403);
  const item = await c.env.DB.prepare(
    'SELECT s.*,e.is_trial FROM event_slots s JOIN events e ON e.id=s.event_id WHERE s.id=? AND e.line_account_id=?',
  )
    .bind(c.req.param('id'), a)
    .first();
  if (!item) throw new StyleError('not_found', 404);
  return c.json({ success: true, data: item });
});

styles.patch(base + '/restaurant-reservations/:id', async (c) => {
  edit(c);
  const a = await account(c),
    b = await json(c);
  if (!(await restaurantEffectivelyEnabledForTenant(c)))
    throw new StyleError('not_found', 404);
  const staffId = text(b.staffId, 100);
  if (
    staffId &&
    !(await c.env.DB.prepare(
      'SELECT id FROM staff WHERE id=? AND line_account_id=? AND is_active=1',
    )
      .bind(staffId, a)
      .first())
  )
    throw new StyleError('staff_not_found', 404);
  const r = await c.env.DB.prepare(
    `UPDATE rt_reservations SET staff_id=?,customer_version=customer_version+1,updated_at=? WHERE id=? AND customer_version=? AND store_id IN(SELECT id FROM rt_stores WHERE line_account_id=?)`,
  )
    .bind(
      staffId,
      new Date().toISOString(),
      c.req.param('id'),
      b.expectedVersion,
      a,
    )
    .run();
  if (!r.meta.changes) throw new StyleError('version_conflict', 409);
  return c.json({ success: true, data: { staffId } });
});
