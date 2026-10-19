import type { AccountStyle } from '@line-crm/shared';
import { readDefinition, standardStarter } from './style-starter-definition.js';
export async function starter(
  db: D1Database,
  tenant: string | null,
  style: AccountStyle,
) {
  const saved = await db
    .prepare(
      `SELECT * FROM style_starter_sets WHERE style=? AND archived_at IS NULL AND (tenant_id=? OR tenant_id IS NULL) ORDER BY tenant_id IS NULL LIMIT 1`,
    )
    .bind(style, tenant)
    .first<{
      id: string;
      version: number;
      definition_json: string;
      auto_insert: number;
    }>();
  return saved
    ? {
        id: saved.id,
        version: saved.version,
        autoInsert: !!saved.auto_insert,
        definition: readDefinition(
          {
            items: (
              JSON.parse(saved.definition_json)
                .items as import('./style-starter-definition.js').StarterItem[]
            ).filter(
              (i) =>
                !(
                  i.kind === 'automation' &&
                  (i.triggerType !== 'restaurant.departed' ||
                    i.key === 'reminder' ||
                    /予約確定/.test(i.name))
                ),
            ),
          },
          style,
        ),
      }
    : {
        id: 'musubo:' + style,
        version: 1,
        autoInsert: true,
        definition: standardStarter(style),
      };
}
