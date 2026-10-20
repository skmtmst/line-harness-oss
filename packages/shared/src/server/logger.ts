import { currentInvocation } from './context.js';

type Level = 'log' | 'info' | 'warn' | 'error' | 'debug';
/** 固定イベント名と数値だけ。例外、URL、本文、任意の文字列をログへ流さない。 */
function write(level: Level, code: string, metrics: { status?: number; durationMs?: number } = {}): void {
  const context = currentInvocation();
  const event = {
    timestamp: new Date().toISOString(), level: level === 'log' ? 'info' : level,
    code: /^[a-zA-Z][a-zA-Z0-9_.-]{0,95}$/.test(code) ? code : 'invalid_log_event',
    requestId: context?.requestId ?? null, invocationId: context?.invocationId ?? null, source: context?.source ?? 'background',
    ...(Number.isInteger(metrics.status) && metrics.status! >= 100 && metrics.status! <= 599 ? { status: metrics.status } : {}),
    ...(Number.isFinite(metrics.durationMs) && metrics.durationMs! >= 0 ? { durationMs: Math.round(metrics.durationMs!) } : {}),
  };
  console[level](JSON.stringify(event));
}
export const logger = {
  log: (code: string, metrics?: { status?: number; durationMs?: number }) => write('log', code, metrics),
  info: (code: string, metrics?: { status?: number; durationMs?: number }) => write('info', code, metrics),
  warn: (code: string, metrics?: { status?: number; durationMs?: number }) => write('warn', code, metrics),
  error: (code: string, metrics?: { status?: number; durationMs?: number }) => write('error', code, metrics),
  debug: (code: string, metrics?: { status?: number; durationMs?: number }) => write('debug', code, metrics),
};
