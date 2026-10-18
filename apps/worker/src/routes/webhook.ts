import { Hono } from 'hono';

import type { Env } from '../index.js';

import { post__webhook_1 } from './webhook-receive.js';

const webhook = new Hono<Env>();

webhook.post('/webhook', post__webhook_1);

export { webhook };
