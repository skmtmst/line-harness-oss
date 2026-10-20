import { expect, it } from 'vitest';
import type { FormSubmission } from '@line-crm/db';
import { serializeIdempotentReplay } from './forms-definition.js';
import { hydrateDocumentAnswers } from '../features/forms/form-documents.js';
it('keeps an old failed reply replayable without exposing the saved upstream payload', async () => {
  const raw = { answer: 'yes', _webhookResult: { eligible: false, secret: 'synthetic-private-upstream', join_url: 'https://example.com/join' } };
  const row = { id: 's', form_id: 'f', friend_id: 'friend', data: JSON.stringify(raw), created_at: '2026-10-18' } as FormSubmission;
  const result = serializeIdempotentReplay(row);
  expect(result).toMatchObject({ data: { answer: 'yes' }, webhookPassed: false, webhookData: { eligible: false } });
  expect(JSON.stringify(result)).not.toContain('synthetic-private-upstream');
  expect(await hydrateDocumentAnswers({} as D1Database, raw, 'owner', 's')).toEqual({ answer: 'yes' });
  expect(JSON.parse(row.data)._webhookResult.secret).toBe('synthetic-private-upstream');
});
