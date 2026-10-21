import { expect, test } from 'vitest';
import { app } from '../index.js';

test('配信承認は内容を確認した版を必須にして版の不一致を公開する', async () => {
  const response = await app.request('/openapi.json');
  expect(response.status).toBe(200);
  const spec = await response.json() as {
    paths: Record<string, { post?: {
      requestBody?: { required?: boolean; content?: { 'application/json'?: { schema?: {
        required?: string[];
        properties?: { expectedVersion?: { type?: string; minimum?: number } };
      } } } };
      responses?: Record<string, { description?: string }>;
    } }>;
  };
  const operation = spec.paths['/api/broadcasts/{id}/approval-approve']?.post;
  const schema = operation?.requestBody?.content?.['application/json']?.schema;
  expect(operation?.requestBody?.required).toBe(true);
  expect(schema?.required).toEqual(['expectedVersion']);
  expect(schema?.properties?.expectedVersion).toMatchObject({ type: 'integer', minimum: 1 });
  expect(operation?.responses?.['400']?.description).toBeTruthy();
  expect(operation?.responses?.['409']?.description).toBeTruthy();
});
