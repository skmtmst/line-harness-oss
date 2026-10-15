import { Hono } from 'hono';

/**
 * S05: HTTP self-update is retired. Deployment uses the operator CLI / CI.
 * Never accept a long-lived deployment key as an application credential.
 * No setting reopens this router; any future HTTP updater needs its own
 * reviewed session, MFA, target restriction and mandatory audit design.
 * Public /admin/version remains in the separate admin-version router.
 */
const app = new Hono();
app.all('*', (c) => c.notFound());
export default app;
