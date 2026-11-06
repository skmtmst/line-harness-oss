import { expect, it } from 'vitest';
import { lineAccountConnectionState, lineConnectionRisk, type LineConnection } from './line-connection-state.js';

it.each([
  [undefined, '未確認', null],
  [{ status: 'unknown' }, '未確認', null],
  [{ status: 'ok' }, '正常', 'normal'],
  [{ status: 'warn' }, '要確認', 'warning'],
  [{ status: 'ok', tokenExpired: true }, '正常', 'normal'],
  [{ status: 'warn', isActive: false }, '停止中', null],
  [{ status: 'warn', archivedAt: '2026-10-01' }, 'アーカイブ', null],
] as Array<[LineConnection | undefined, string, string | null]>)('保存状態 %j を画面とヘルスAPIで同じ意味にする', (connection, label, risk) => {
  expect(lineAccountConnectionState({ connection }).label).toBe(label);
  expect(lineConnectionRisk(connection)).toBe(risk);
});

it('403は危険とし、ネットワーク失敗と401を正常にしない', () => {
  for (const httpStatus of [403, 401, null]) {
    const connection: LineConnection = { status: 'warn', issues: [{ kind: 'bot_info', result: 'failed', httpStatus, expectedUrl: null, registeredUrl: null, webhookActive: null }] };
    expect(lineConnectionRisk(connection)).toBe(httpStatus === 403 ? 'danger' : 'warning');
  }
});
