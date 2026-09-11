/*
 * #662 / N-059 — 失敗を「確かに届いていない」と「分からない」に分ける。
 *
 * ここを分けないと機能が空になるか、二重送信になる。
 *
 *   全部を送達不明に倒す → 再送できる相手がいなくなり、失敗分再送が
 *                          何もしない機能になる
 *   全部を失敗に倒す     → 届いた相手へ2通目が出る
 */
import { describe, expect, it } from 'vitest';
import { classifyDeliveryFailure, deliveryErrorCode } from './broadcast-delivery-outcome.js';

function lineError(status: number): Error {
  const err = new Error(`LINE API error: ${status}`);
  Object.assign(err, { status });
  return err;
}

describe('送信失敗の分け方', () => {
  it('4xx は「届いていない」。要求は LINE まで届き、受け取られなかった', () => {
    for (const status of [400, 401, 403, 404, 429]) {
      expect(classifyDeliveryFailure(lineError(status))).toBe('failed');
    }
  });

  it('5xx は「分からない」。LINE の中で落ちたので、受け取ったあとかもしれない', () => {
    for (const status of [500, 502, 503]) {
      expect(classifyDeliveryFailure(lineError(status))).toBe('unknown');
    }
  });

  it('状態番号が読めない失敗は「分からない」。推測して失敗側へ倒さない', () => {
    expect(classifyDeliveryFailure(new Error('network unreachable'))).toBe('unknown');
    expect(classifyDeliveryFailure(undefined)).toBe('unknown');
    expect(classifyDeliveryFailure(null)).toBe('unknown');
    // 文字列の '400' は状態番号として読まない（読むと、別の理由で
    // status に文字列が入った失敗を「届いていない」と断定してしまう）。
    expect(classifyDeliveryFailure({ status: '400' })).toBe('unknown');
    expect(classifyDeliveryFailure({ status: Number.NaN })).toBe('unknown');
  });

  it('台帳に残す理由は、状態番号が読めればそれを載せる', () => {
    expect(deliveryErrorCode(lineError(429))).toBe('line_http_429');
    expect(deliveryErrorCode(new Error('timeout'))).toBe('line_no_response');
  });
});
