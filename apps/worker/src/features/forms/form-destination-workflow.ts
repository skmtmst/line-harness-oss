import { getWorkflowStep } from '@line-crm/db';
import { acquireWorkflow, WorkflowDeferred } from '../../services/workflow-execution.js';

type Stats = { attempted: number; succeeded: number; failed: number };
/** Each SQL mutation and its result commit together; a partial block can resume without repeating successful writes. */
export async function writeFormDestinationsOnce(input: {
  db: D1Database; friendId: string; sourceKey?: string; blockId: string;
  stats: Stats; write: (db: D1Database, stats: Stats) => Promise<void>;
}): Promise<void> {
  if (!input.sourceKey) return input.write(input.db, input.stats);
  const ref = { scopeId: `friend:${input.friendId}`, processKind: 'form_destinations', subjectId: `${input.sourceKey}:${input.blockId}` };
  const execution = await acquireWorkflow(input.db, ref, { maxAttempts: 50 });
  let delta: Stats;
  if (!execution) {
    const completed = await getWorkflowStep(input.db, { ...ref, stepKey: '__run' });
    if (completed?.status !== 'succeeded') throw new WorkflowDeferred(completed?.status ?? 'unavailable');
    delta = JSON.parse(completed.result_json!);
  } else {
    delta = { attempted: 0, succeeded: 0, failed: 0 };
    try {
      await input.write(execution.mutationDb('destinations'), delta);
      if (delta.failed) throw new WorkflowDeferred('destination_failed');
      await execution.complete(delta);
    } catch (error) {
      await execution.fail();
      for (const key of ['attempted','succeeded','failed'] as const) input.stats[key] += delta[key];
      throw error;
    }
  }
  for (const key of ['attempted','succeeded','failed'] as const) input.stats[key] += delta[key];
}
