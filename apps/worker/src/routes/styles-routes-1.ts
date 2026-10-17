import { accountFeatureIsEnabled } from '../services/feature-enforcement.js';
import { restaurantEffectivelyEnabledForTenant } from '../services/tenant-features.js';
import { Hono } from 'hono';

import type { Env } from '../index.js';

import { hasStaffPermission, requireRole } from '../middleware/role-guard.js';
import { StyleError, checkStyle, defaultCards, features, profile, profileAnswers, questionsForStyle, readCards, saveProfile, starter, styleWarnings } from '../services/style-setup.js';
import { styleSnapshot, styleWindow } from '../services/style-analytics.js';
import { styleSchedule } from '../services/style-schedule.js';
import { templateSamples } from '../services/style-template-samples.js';

import { base, hq, account, json, edit, text, oneOf, version, staffFilter, bookingAudience } from './styles-common.js';
export const styles = new Hono<Env>();

styles.get(base, async (c) => {
  const id = await account(c),
    p = await profile(c.env.DB, id),
    style = p?.style ?? 'standard';
  return c.json({
    success: true,
    data: {
      style,
      styleSelected: !!p?.selected_at && p.selection_mode === 'configured',
      styleMode: p?.selection_mode ?? 'later',
      version: p?.version ?? 0,
      answers: profileAnswers(p),
      settings: JSON.parse(p?.settings_json ?? '{}'),
      cards: p?.cards_json ? JSON.parse(p.cards_json) : defaultCards(style),
      questions: questionsForStyle(style).map((key) => ({
        key,
        ...(features[key] ? { changeAt: features[key] } : {}),
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

styles.get(base + '/template-samples', async (c) => {
  await account(c);
  if (!hasStaffPermission(c, '/templates'))
    throw new StyleError('forbidden', 403);
  const style = checkStyle(c.req.query('style'));
  return c.json({
    success: true,
    data: { style, items: templateSamples(style) },
  });
});

styles.get('/api/hq/style-template-samples', async (c) => {
  await hq(c);
  const style = checkStyle(c.req.query('style'));
  return c.json({
    success: true,
    data: { style, items: templateSamples(style) },
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

for (const path of [
  '/summary',
  '/analytics',
  '/bookings',
  '/people',
  '/schedule',
])
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
    const staffId = await staffFilter(c, id, style);
    if (path === '/schedule')
      return c.json({
        success: true,
        data: await styleSchedule(
          c.env.DB,
          id,
          { style, ...(await styleWindow(c.env.DB, id, c.req.query())) },
          c.req.query(),
          staffId,
          {
            email: c.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            privateKey: c.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
          },
        ),
      });
    const data = await styleSnapshot(
      c.env.DB,
      id,
      style,
      c.req.query(),
      staffId,
    );
    return c.json({ success: true, data });
  });

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
