import type { StarterItem } from './style-starter-definition.js';

/** タグの見本はタグの表に行を持たないので、初期セットの行だけで指す決まった ID。 */
export function starterTagSetTarget(key: string) {
  return 'starter-tag-set:' + key;
}

/** シナリオの見本の通数。すべて文だけで、前の通（1 通目は始まり）からの分で並べる。 */
export function scenarioStepStatements(
  db: D1Database,
  scenarioId: string,
  item: StarterItem,
  now: string,
) {
  return (item.steps ?? []).map((step, index) =>
    db
      .prepare(
        `INSERT INTO scenario_steps(id,scenario_id,step_order,delay_minutes,message_type,message_content,created_at) VALUES(?,?,?,?,'text',?,?)`,
      )
      .bind(crypto.randomUUID(), scenarioId, index, step.delayMinutes, step.text, now),
  );
}
