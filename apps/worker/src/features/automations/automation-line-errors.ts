import { AutomationActionError } from './automation-engine.js';

/**
 * R363: メッセージ送信時の失敗分類。受理した可能性がある失敗は
 * `delivery_unconfirmed`（照合待ち）にして自動返却・再送を止める。
 *
 * - 4xx拒否 … 未受理が確定。返却してよい失敗。
 * - 429 … 処理されていない。再試行してよい失敗。
 * - 5xx・応答なし（タイムアウト・通信断）・200のJSON読取失敗 …
 *   受理した可能性がある。照合待ちに残す。
 *
 * `retryable` は他経路の再試行の目安として従来どおり true を保つ。
 * マイル特典の配送はコードで照合待ちにし、返却も再送もしない。
 */
export function classifyLinePushError(error: unknown): AutomationActionError {
  if (error instanceof AutomationActionError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const status = (error as { status?: unknown } | null)?.status;
  const unconfirmed = (note: string): AutomationActionError => new AutomationActionError(
    'delivery_unconfirmed',
    note,
    true,
  );
  if (typeof status === 'number') {
    if (status === 429) {
      return new AutomationActionError('line_temporary_failure', message, true);
    }
    if (status >= 400 && status < 500) {
      return new AutomationActionError('line_request_rejected', message, false);
    }
    return unconfirmed('LINEの応答が不確定のため、送信結果を確認しています');
  }
  // 実SDKは status を付けるが、付けない呼び出しもあるため文面でも見る。
  if (/LINE API error:\s*(400|401|403|404)\b/.test(message)) {
    return new AutomationActionError('line_request_rejected', message, false);
  }
  if (/LINE API error:\s*(429)\b/.test(message)) {
    return new AutomationActionError('line_temporary_failure', message, true);
  }
  if (/LINE API error:\s*5\d\d\b/.test(message)) {
    return unconfirmed('LINEの応答が不確定のため、送信結果を確認しています');
  }
  if (error instanceof SyntaxError) {
    // 200を受理した後のJSON読取失敗。送達は不明なので照合待ち。
    return new AutomationActionError(
      'delivery_unconfirmed',
      'LINEの応答が不確定のため、送信結果を確認しています',
      true,
    );
  }
  // 応答が返らない（タイムアウト・通信断）。受理不明として照合待ち。
  return new AutomationActionError(
    'delivery_unconfirmed',
    'LINEの応答が届かないため、送信結果を確認しています',
    true,
  );
}
