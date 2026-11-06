import { expect, test } from 'vitest';
import { validateEvent } from './ec-integrations.js';
const event={event_id:'calendar-validation',event_type:'ec.customer.profile_updated',occurred_at:'2026-10-01T00:00:00Z'};
test('API-02 pet birthday must be a real calendar date',()=>{
 expect(validateEvent({...event,profile:{pets:[{name:'Pet',birthday:'2026-02-30'}]}})).toBe(false);
 expect(validateEvent({...event,profile:{pets:[{name:'Pet',birthday:'2024-02-29'}]}})).toBe(true);
});
