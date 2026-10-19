export type { Env } from './env.js';
import type { Env } from './env.js';
/**
 * LINE Harness Plugin: MyService
 *
 * Cloudflare Worker that syncs data from MyService → LINE Harness
 * and sends notifications based on external conditions.
 *
 * Replace "MyService" with your actual service name throughout this template.
 */

import { syncExternalData } from './sync.js'
import { checkAndNotify } from './notify.js'

export default {
  /**
   * Cron trigger: runs on the schedule defined in wrangler.toml.
   * Use this for periodic sync and notification checks.
   */
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    console.log('[MyService Plugin] Cron triggered')

    // Step 1: Sync external data → LINE Harness tags/metadata
    await syncExternalData(env)

    // Step 2: Check conditions and send notifications
    await checkAndNotify(env)
  },

  /**
   * HTTP handler: use for webhooks from the external service.
   * e.g., MyService sends a webhook when a booking is confirmed.
   */
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url)

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', plugin: 'myservice' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Webhook endpoint: receives events from MyService
    if (url.pathname === '/webhook' && request.method === 'POST') {
      // TODO: Validate webhook signature from MyService before reading its body.
      // TODO: Process the verified webhook event with a stable idempotency key.
      // This template has neither provider contract yet. Fail closed and never
      // log customer payloads or acknowledge an unprocessed event as received.
      return new Response(JSON.stringify({ error: 'Webhook integration is not configured' }), {
        status: 501,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response('Not Found', { status: 404 })
  },
}
