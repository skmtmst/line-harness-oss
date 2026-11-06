import type { D1Timing } from './d1-timing.js';

// 固定の名前と数値だけを公開する。段は排他的、内訳のspanは親の段に含まれる。
export type TimingStage = 'cors' | 'rate' | 'auth' | 'tenant' | 'pii' | 'audit' | 'feature' | 'sensitive';
export type TimingSpan = 'session' | 'staff' | 'scope' | 'impersonation' | 'handler';
export type ServerTiming = {
  start: number;
  parts: Partial<Record<TimingStage | TimingSpan, number>>;
  d1: D1Timing;
};
