import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { base, hq, json, account, edit } from './styles-common.js';
import { checkStyle, StyleError } from '../services/style-setup.js';
import {
  starterDistributionPlan,
  distributeStarter,
} from '../services/style-starter-distribution.js';
import {
  overwriteResource,
  resourceSnapshot,
  snapshotGuard,
  recordSnapshot,
} from '../services/style-starter-resource.js';
import type { StarterItem } from '../services/style-starter-definition.js';
export const styleStarterDistribution = new Hono<Env>();
const path = '/api/hq/style-starter-sets/:style';
styleStarterDistribution.post(path + '/preflight', async (c) => {
  const tenant = await hq(c),
    style = checkStyle(c.req.param('style')),
    b = await json(c);
  const plan = await starterDistributionPlan(c.env.DB, tenant, style, b);
  return c.json({
    success: true,
    data: {
      token: plan.token,
      accountCount: plan.accountCount,
      editedCount: plan.editedCount,
      accounts: plan.accounts.map((a) => ({
        accountId: a.accountId,
        editedCount: a.editedCount,
        items: a.items.map(({ binding, snapshot, ...i }) => i),
      })),
    },
  });
});
styleStarterDistribution.post(path + '/distribute', async (c) =>
  c.json({
    success: true,
    data: await distributeStarter(
      c.env.DB,
      await hq(c),
      c.get('staff').id,
      checkStyle(c.req.param('style')),
      await json(c),
    ),
  }),
);
styleStarterDistribution.post(
  base + '/starter-items/:key/accept-update',
  async (c) => {
    edit(c);
    const a = await account(c),
      b = await json(c),
      key = c.req.param('key') ?? '';
    if (b.confirmed !== true) throw new StyleError('confirmation_required');
    const binding = await c.env.DB.prepare(
      'SELECT * FROM style_starter_items WHERE line_account_id=? AND item_key=? AND pending_update IS NOT NULL',
    )
      .bind(a, key)
      .first<{
        style: string;
        kind: string;
        target_id: string;
        pending_update: string;
      }>();
    if (!binding) throw new StyleError('not_found', 404);
    const pending = JSON.parse(binding.pending_update) as {
      setId: string;
      setVersion: number;
      item: StarterItem;
    };
    if (b.expectedSetVersion !== pending.setVersion)
      throw new StyleError('version_conflict', 409);
    const snapshot = await resourceSnapshot(
      c.env.DB,
      a,
      binding.kind,
      binding.target_id,
    );
    if (b.expectedSnapshot !== snapshot)
      throw new StyleError('version_conflict', 409);
    await c.env.DB.batch([
      snapshotGuard(c.env.DB, a, binding.kind, binding.target_id, snapshot),
      c.env.DB.prepare(
        `SELECT json(CASE WHEN EXISTS(SELECT 1 FROM style_starter_items WHERE line_account_id=? AND item_key=? AND pending_update=?) THEN '{}' ELSE 'STYLE_VERSION_CONFLICT' END)`,
      ).bind(a, key, binding.pending_update),
      ...(await overwriteResource(
        c.env.DB,
        a,
        binding.target_id,
        pending.item,
        new Date().toISOString(),
      )),
      c.env.DB.prepare(
        'UPDATE style_starter_items SET set_id=?,set_version=?,pending_update=NULL WHERE line_account_id=? AND item_key=?',
      ).bind(pending.setId, pending.setVersion, a, key),
      recordSnapshot(
        c.env.DB,
        a,
        binding.style,
        key,
        binding.kind,
        binding.target_id,
      ),
      c.env.DB.prepare(
        `INSERT INTO style_change_logs(id,line_account_id,actor_id,action,after_json,created_at) VALUES(?,?,?,'starter.accept_update',?,?)`,
      ).bind(
        crypto.randomUUID(),
        a,
        c.get('staff').id,
        JSON.stringify({
          key,
          setId: pending.setId,
          setVersion: pending.setVersion,
        }),
        new Date().toISOString(),
      ),
    ]);
    return c.json({ success: true });
  },
);
