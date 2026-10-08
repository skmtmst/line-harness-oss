import { workflowFence, type WorkflowStepRef } from '@line-crm/db';
import { classifySingleStatement } from './incoming-webhook-fenced-db.js';
/** All receipt-owned writes share an atomic D1 transaction with their lease fence. */
export function workflowFencedDb(
  db: D1Database,
  fence: WorkflowStepRef & { owner: string },
): D1Database {
  const statements = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const assertLease = () => workflowFence(db,fence,fence.owner);
  const atomic = async (items: D1PreparedStatement[]) => {
    // D1.batch is a SQL transaction. Invalid JSON deliberately raises a D1-compatible
    // SQL error on a lost lease; the entire batch is rolled back, including its writes.
    const results = await db.batch([assertLease(), ...items]);
    return results.slice(1);
  };
  const wrap = (statement: D1PreparedStatement, readOnly: boolean): D1PreparedStatement => {
    const wrapped = new Proxy(statement, {
      get(target, property) {
        if (typeof property === 'symbol') return undefined;
        if (property === 'bind') return (...values: unknown[]) => wrap(target.bind(...values), readOnly);
        if (property === 'run') return async () => (await atomic([target]))[0];
        // INSERT/UPDATE RETURNING must be fenced in the same transaction as the mutation.
        if ((property === 'first' || property === 'all') && readOnly) {
          return target[property].bind(target);
        }
        if(property==='first'||property==='all')return async(column?:string)=>{
          const result=(await atomic([target]))[0]!;
          if(property==='all')return result;
          const row=result.results?.[0] ?? null;return column===undefined?row:(row as Record<string,unknown>|null)?.[column] ?? null;
        };
        if (property === 'raw') {
          throw new Error(`workflow_unsupported_statement_api:${property}`);
        }
        return undefined;
      },
    });
    statements.set(wrapped, statement);
    return wrapped;
  };
  return new Proxy(db, {
    get(target, property) {
      if (typeof property === 'symbol') return undefined;
      if (property === 'prepare') return (sql: string) => {
        const single = classifySingleStatement(sql);
        return wrap(target.prepare(single.sql), single.readOnly);
      };
      if (property === 'batch') return (items: D1PreparedStatement[]) => atomic(items.map(item => {
        const original = statements.get(item);
        if (!original) throw new Error('workflow_foreign_statement');
        return original;
      }));
      if (property === 'exec' || property === 'withSession' || property === 'dump') {
        throw new Error(`workflow_unsupported_database_api:${property}`);
      }
      return undefined;
    },
  });
}
