import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { requireEcPermission } from './ec-operations.js';
import { account, base } from './styles-common.js';
import { profile, StyleError } from '../services/style-setup.js';
import { ecStyleSummary } from '../services/style-ec-summary.js';

export const styleEcSummary = new Hono<Env>();
styleEcSummary.get(base + '/ec-summary', requireEcPermission('ec.event.view'), async c => {
  const id = await account(c);
  const p = await profile(c.env.DB, id);
  if (p?.style !== 'ec' || p.selection_mode !== 'configured') throw new StyleError('not_found', 404);
  c.header('Cache-Control', 'private, no-store');
  return c.json({ success: true, data: await ecStyleSummary(c.env.DB, id, c.req.query()) });
});
