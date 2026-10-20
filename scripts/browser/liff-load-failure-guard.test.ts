import { describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { customerFailureViolations, emptyFailureBranches } from './liff-load-failure-guard.js';

describe('LIFFの失敗を空と分ける見張り', () => {
  test.each([
    'const data = await load().catch(() => []);',
    'try { await load(); } catch { setRequests([]); }',
    'if (!response.ok) return [];',
  ])('失敗を空配列へ変える枝を検出: %s', source => expect(emptyFailureBranches(source)).toHaveLength(1));
  test.each([
    'try { await load(); } catch { setFailed(true); setSlots([]); }',
    'fetch().then(() => setRows([])).catch(() => setError("失敗"));',
    'if (!account) return [];',
  ])('失敗状態と正当なリセットを区別: %s', source => expect(emptyFailureBranches(source)).toEqual([]));
  test('お客さまの全ソースに黙った空置換を許さない', () => {
    const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
    expect(customerFailureViolations(root)).toEqual([]);
  });
});
