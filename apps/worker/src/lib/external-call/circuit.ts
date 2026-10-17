import { scopeKey } from './policy.js';
import type { CallScope, CircuitAdmission, CircuitLease, CircuitStore } from './types.js';

type Circuit = { failures: number; until: number; probing: boolean; generation: number; recoveries: number };
/**
 * Explicitly ISOLATE-LOCAL. Reuse one instance; not a distributed stop switch.
 * Cross-isolate callers must inject an atomic shared store, preserving fencing
 * and single-probe semantics. No automatic eviction of open / probing entries.
 */
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
    if (result === 'neutral') { if (lease.probe) circuit.generation++; return; } // Auth failure / cancellation never demonstrate recovery.
    if (result === 'failure') {
      circuit.failures++;
      if (lease.probe || circuit.failures >= this.failureThreshold) {
        circuit.until = Math.max(now + this.openMs, retryAt ?? 0);
        circuit.generation++;
        circuit.recoveries = 0;
      }
    } else if (lease.probe) {
      // Two serial successful probes, rather than a single success releasing a burst.
      circuit.recoveries++;
      circuit.generation++;
      if (circuit.recoveries >= 2) { circuit.until = 0; circuit.failures = 0; }
    } else { circuit.failures = 0; }
  }
}
