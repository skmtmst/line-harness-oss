import { Hono } from 'hono';

import type { Env } from '../worker-env.js';

import { post__webhook_1 } from './webhook-receive.js';

const webhook = new Hono<Env>();

webhook.post('/webhook', post__webhook_1);
webhook.post('/webhook/:channelId', post__webhook_1);

export { webhook };
