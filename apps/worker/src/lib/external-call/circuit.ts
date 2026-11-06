import { scopeKey } from './policy.js';
import type { CallScope, CircuitAdmission, CircuitLease, CircuitStore } from './types.js';

type Circuit = { failures: number; until: number; probing: boolean; generation: number; recoveries: number };
/** この状態は isolate 内だけで共有する。複数 isolate では実行権と単一の回復確認を守る原子的な共有ストアを注入し、停止中・確認中の記録を自動削除しない。 */
export class MemoryCircuitStore implements CircuitStore {
  private readonly circuits = new Map<string, Circuit>();
  constructor(private readonly failureThreshold = 5, private readonly openMs = 30_000) {
    if (![failureThreshold, openMs].every(n => Number.isSafeInteger(n) && n > 0)) throw new TypeError('Invalid circuit policy');
  }
  async acquire(scope: CallScope, now: number): Promise<CircuitAdmission> {
    const key = scopeKey(scope);
    let circuit = this.circuits.get(key);
    if (!circuit) {
      circuit = { failures: 0, until: 0, probing: false, generation: 0, recoveries: 0 };
      this.circuits.set(key, circuit);
    }
    if (circuit.probing || circuit.until > now) return { allowed: false, nextAt: Math.max(now + 1, circuit.until) };
    const probe = circuit.until !== 0;
    if (probe) circuit.probing = true;
    return { allowed: true, lease: { scopeKey: key, generation: circuit.generation, probe } };
  }
  async settle(lease: CircuitLease, result: 'success' | 'failure' | 'neutral', now: number, retryAt?: number): Promise<void> {
    const circuit = this.circuits.get(lease.scopeKey);
    if (!circuit || circuit.generation !== lease.generation) return;
    if (lease.probe) circuit.probing = false;
    if (result === 'neutral') { if (lease.probe) circuit.generation++; return; } // 認証失敗や取消は、接続が回復した根拠として扱わない。
    if (result === 'failure') {
      circuit.failures++;
      if (lease.probe || circuit.failures >= this.failureThreshold) {
        circuit.until = Math.max(now + this.openMs, retryAt ?? 0);
        circuit.generation++;
        circuit.recoveries = 0;
      }
    } else if (lease.probe) {
      // 単発の成功で要求が集中しないよう、順番に2回の成功を確認して解除する。
      circuit.recoveries++;
      circuit.generation++;
      if (circuit.recoveries >= 2) { circuit.until = 0; circuit.failures = 0; }
    } else { circuit.failures = 0; }
  }
}
