/** ブラウザでは本文・例外を記録せず、サーバーの追跡番号だけを関連付ける。 */
export function createClientLogger(source: 'admin' | 'liff' | 'embedded' | 'shared') {
  const write = (level: 'log' | 'info' | 'warn' | 'error', code: string, error?: unknown) => {
    const detail = error !== null && typeof error === 'object' ? error as { requestId?: unknown; trackingId?: unknown } : {};
    const id = detail.requestId ?? detail.trackingId;
    const requestId = typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : null;
    console[level](JSON.stringify({ timestamp: new Date().toISOString(), level: level === 'log' ? 'info' : level,
      code: /^[A-Za-z][A-Za-z0-9_.-]{0,95}$/.test(code) ? code : 'invalid_log_event', requestId, invocationId: null, source }));
  };
  return { log: (code: string, error?: unknown) => write('log', code, error),
    info: (code: string, error?: unknown) => write('info', code, error),
    warn: (code: string, error?: unknown) => write('warn', code, error),
    error: (code: string, error?: unknown) => write('error', code, error) };
}
