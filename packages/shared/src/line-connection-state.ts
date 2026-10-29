/** 保存した接続確認の公開契約。資格情報そのものは含めない。 */
export type LineConnectionIssue = {
  kind: 'bot_info' | 'webhook_endpoint' | 'webhook_test' | 'webhook_silence';
  result: 'mismatched' | 'unconfigured' | 'failed';
  expectedUrl: string | null;
  registeredUrl: string | null;
  webhookActive: boolean | null;
  httpStatus: number | null;
};

export type LineConnection = {
  status?: 'ok' | 'warn' | 'unknown';
  checkedAt?: string | null;
  isActive?: boolean;
  archivedAt?: string | null;
  tokenExpired?: boolean;
  issues?: LineConnectionIssue[];
};

type ConnectionAccount = { isActive?: boolean; archivedAt?: string | null; connection?: LineConnection };

/** 稼働・保管の状態を先に示し、未確認や期限だけの注意を接続の故障と混ぜない。 */
export function lineAccountConnectionState(account: ConnectionAccount): {
  label: '正常' | '要確認' | '未確認' | '停止中' | 'アーカイブ';
  tone: 'ok' | 'warn' | 'idle';
} {
  if (account.archivedAt ?? account.connection?.archivedAt) return { label: 'アーカイブ', tone: 'idle' };
  if ((account.isActive ?? account.connection?.isActive) === false) return { label: '停止中', tone: 'idle' };
  if (account.connection?.status === 'ok') return { label: '正常', tone: 'ok' };
  if (account.connection?.status === 'warn') return { label: '要確認', tone: 'warn' };
  return { label: '未確認', tone: 'idle' };
}

/** 既存のヘルスAPIの色へ変換する。送信量の警告は接続の故障にしない。 */
export function lineConnectionRisk(connection: LineConnection | undefined): 'normal' | 'warning' | 'danger' | null {
  const state = lineAccountConnectionState({ connection });
  if (state.tone === 'ok') return 'normal';
  if (state.tone !== 'warn') return null;
  return connection?.issues?.some(issue => issue.kind === 'bot_info' && issue.httpStatus === 403) ? 'danger' : 'warning';
}
