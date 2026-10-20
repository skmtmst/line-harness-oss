import { bad } from '../services/event-input-error.js';
import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import { ACCOUNT_ACCESS_ERROR } from './events/input.js';
import { registerAdminCatalog } from './events/register-admin-catalog.js';
import { registerAdminLifecycle } from './events/register-admin-lifecycle.js';
import { registerSlotsRead } from './events/register-slots-read.js';
import { registerSlotsWrite } from './events/register-slots-write.js';
import { registerLiffHistory } from './events/register-liff-history.js';
import { registerLiffChange } from './events/register-liff-change.js';
import { registerLiffCatalog } from './events/register-liff-catalog.js';
import { registerLiffWaitlist } from './events/register-liff-waitlist.js';
import { registerLiffCreate } from './events/register-liff-create.js';
import { registerAdminBookings } from './events/register-admin-bookings.js';
import { registerAdminActions } from './events/register-admin-actions.js';

export type { EventQuestion } from './event-input.js';

const events = new Hono<Env>();

events.use('/api/events/admin/*', async (c, next) => {
  const accountId = c.req.query('account_id');
  if (
    accountId
    && !(await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId]))
  ) {
    return bad(c, ACCOUNT_ACCESS_ERROR, 403);
  }
  await next();
});

registerAdminCatalog(events);

registerAdminLifecycle(events);

registerSlotsRead(events);

registerSlotsWrite(events);

registerLiffHistory(events);

registerLiffChange(events);

registerLiffCatalog(events);

registerLiffWaitlist(events);

registerLiffCreate(events);

registerAdminBookings(events);

registerAdminActions(events);

export type { FutureEventSlotSummary } from './events/future-slots.js';

export { summarizeFutureEventSlots } from './events/future-slots.js';

export default events;
