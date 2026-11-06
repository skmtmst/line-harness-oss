import { ensureWorkflowStep, getWorkflowStep, workflowBindings, workflowJson, WORKFLOW_WHERE, type WorkflowStepRef } from '@line-crm/db';

import { scopeKey } from '../../lib/external-call/index.js';
import { type CallScope, type CircuitAdmission, type CircuitLease, type CircuitStore } from '../../lib/external-call/types.js';

interface Circuit {
  failures: number;
  until: number;
  probeUntil: number;
  generation: number;
  recoveries: number;
}
const initial: Circuit = { failures: 0, until: 0, probeUntil: 0, generation: 0, recoveries: 0 };

/** 予約系の遮断状態。既存の共有checkpointの一意キーとCASでisolateをまたぐ。 */
export class BookingExternalCircuits implements CircuitStore {
  constructor(private readonly db: D1Database) {}
  private ref(key: string): WorkflowStepRef {
    return { scopeId: key, processKind: 'booking_external_circuit', subjectId: 'connection', stepKey: 'circuit' };
  }
  private async read(key: string, now: number) {
    const ref = this.ref(key);
    const row = await ensureWorkflowStep(this.db, ref, { now, input: { scope: key }, maxAttempts: 1 });
    const value: Circuit = row.result_json ? JSON.parse(row.result_json) : { ...initial };
    if (![value.failures, value.until, value.probeUntil, value.generation, value.recoveries]
      .every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('booking_circuit_invalid');
    return { ref, row, value };
  }
  private async cas(ref: WorkflowStepRef, previous: string | null, value: Circuit, now: number) {
    const updated = await this.db.prepare(`UPDATE workflow_steps SET result_json=?,updated_at=?
      WHERE ${WORKFLOW_WHERE} AND result_json IS ?`)
      .bind(workflowJson(value), now, ...workflowBindings(ref), previous).run();
    return updated.meta.changes === 1;
  }
  async acquire(scope: CallScope, now: number): Promise<CircuitAdmission> {
    const key = scopeKey(scope);
    for (let attempt = 0; attempt < 4; attempt++) {
      const { ref, row, value } = await this.read(key, now);
      if (value.until > now || value.probeUntil > now) {
        return { allowed: false, nextAt: Math.max(now + 1, value.until, value.probeUntil) };
      }
      if (!value.until) return { allowed: true, lease: { scopeKey: key, generation: value.generation, probe: false } };
      // 期限切れのprobeを回収すると世代を進める。遅れて来た旧probeの結果は捨てる。
      const next = { ...value, generation: value.generation + 1, probeUntil: now + 60_000 };
      if (await this.cas(ref, row.result_json, next, now)) {
        return { allowed: true, lease: { scopeKey: key, generation: next.generation, probe: true } };
      }
    }
    return { allowed: false, nextAt: now + 1_000 };
  }
  async settle(lease: CircuitLease, result: 'success' | 'failure' | 'neutral', now: number, retryAt?: number): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const ref = this.ref(lease.scopeKey), row = await getWorkflowStep(this.db, ref);
      if (!row) return;
      const value: Circuit = row.result_json ? JSON.parse(row.result_json) : { ...initial };
      if (value.generation !== lease.generation) return;
      const next = { ...value };
      if (lease.probe) next.probeUntil = 0;
      if (result === 'neutral') {
        if (!lease.probe) return;
        next.generation++;
      } else if (result === 'failure') {
        next.failures++;
        if (lease.probe || next.failures >= 5) {
          next.until = Math.max(now + 30_000, retryAt ?? 0);
          next.generation++;
          next.recoveries = 0;
        }
      } else if (lease.probe) {
        next.recoveries++;
        next.generation++;
        if (next.recoveries >= 2) { next.until = 0; next.failures = 0; }
      } else next.failures = 0;
      if (await this.cas(ref, row.result_json, next, now)) return;
    }
    throw new Error('booking_circuit_conflict');
  }
}
