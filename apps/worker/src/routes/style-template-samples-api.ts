import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { hasStaffPermission } from '../middleware/role-guard.js';
import { StyleError, checkStyle } from '../services/style-setup.js';
import { templateSamples } from '../services/style-template-samples.js';
import { base, hq, account, json } from './styles-common.js';

export const styleTemplateSamples=new Hono<Env>();


styleTemplateSamples.get(base + '/template-samples', async (c) => {
  await account(c);
  if (!hasStaffPermission(c, '/templates'))
    throw new StyleError('forbidden', 403);
  const style = checkStyle(c.req.query('style'));
  return c.json({
    success: true,
    data: { style, items: templateSamples(style) },
  });
});


styleTemplateSamples.get('/api/hq/style-template-samples', async (c) => {
  await hq(c);
  const style = checkStyle(c.req.query('style'));
  return c.json({
    success: true,
    data: { style, items: templateSamples(style) },
  });
});
