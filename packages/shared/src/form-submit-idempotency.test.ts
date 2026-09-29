import { describe, expect, it } from 'vitest';
import {
  buildFormSubmitHeaders,
  newFormIdempotencyKey,
  toFormIdempotencyKey,
} from './form-submit-idempotency.js';

const UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('フォーム回答の冪等キー(#729)', () => {
  it('UUID をキー型にする', () => {
    expect(toFormIdempotencyKey(UUID)).toBe(UUID);
  });

  it('空文字・UUIDでない値はキーにしない（サーバも 400 で断る）', () => {
    expect(() => toFormIdempotencyKey('')).toThrow('idempotency_key_must_be_uuid');
    expect(() => toFormIdempotencyKey('key-abc')).toThrow('idempotency_key_must_be_uuid');
    expect(() => toFormIdempotencyKey('not-a-uuid')).toThrow('idempotency_key_must_be_uuid');
  });

  it('新しいキーは UUID の形で作る', () => {
    const key = newFormIdempotencyKey();
    expect(toFormIdempotencyKey(key)).toBe(key);
  });

  it('ヘッダは Content-Type と Idempotency-Key を必ず持つ', () => {
    const key = toFormIdempotencyKey(UUID);
    expect(buildFormSubmitHeaders(key)).toEqual({
      'Content-Type': 'application/json',
      'Idempotency-Key': UUID,
    });
  });

  it('Authorization を渡せば付け、渡さなければ付けない', () => {
    const key = toFormIdempotencyKey(UUID);
    expect(buildFormSubmitHeaders(key, { authorization: 'Bearer token' })).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer token',
      'Idempotency-Key': UUID,
    });
  });
});
