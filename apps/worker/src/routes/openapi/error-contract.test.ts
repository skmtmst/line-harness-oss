import { describe, expect, it } from 'vitest';
import { paths } from './paths.js';
import { withApiErrorContract } from './error-contract.js';

describe('OpenAPIの共通失敗契約', () => {
  it('全path/methodと成功の形を保ち、全失敗を共通schemaへつなぐ', () => {
    const before = structuredClone(paths) as Record<string, Record<string, { responses?: Record<string, Record<string, unknown>> }>>;
    const after = withApiErrorContract(paths) as typeof before;
    expect(Object.keys(after)).toEqual(Object.keys(before));
    let checked = 0;
    for (const [path, item] of Object.entries(before)) {
      expect(Object.keys(after[path])).toEqual(Object.keys(item));
      for (const [method, operation] of Object.entries(item)) {
        for (const [status, response] of Object.entries(operation.responses ?? {})) {
          const actual = after[path][method].responses![status];
          if (Number(status) >= 400 || status === 'default') {
            expect(JSON.stringify(actual.content)).toContain('#/components/schemas/ApiErrorResponse');
            checked++;
          } else {
            const { headers: _oldHeaders, ...old } = response;
            const { headers: _newHeaders, ...now } = actual;
            expect(now).toEqual(old);
          }
          expect(actual.headers).toHaveProperty('X-Request-ID');
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(paths).toEqual(before);
  });
});
