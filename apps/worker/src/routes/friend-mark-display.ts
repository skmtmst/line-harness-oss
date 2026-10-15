import { parseSupportMarkLocations } from '@line-crm/shared';
import { type SupportMark } from '@line-crm/db';
import { listSupportMarkAutomationRulesForAccount } from '../services/support-mark-automation.js';

export function serializeMark(
  row: SupportMark,
  automationRules: Awaited<ReturnType<typeof listSupportMarkAutomationRulesForAccount>> = [],
) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    isDefault: Boolean(row.is_default),
    autoOnInbound: Boolean(row.auto_on_inbound),
    displayOrder: row.display_order,
    displayLocations: parseSupportMarkLocations(JSON.parse(row.display_locations_json)),
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    version: Number(row.version ?? 1),
    isInherited: Boolean(row.is_inherited),
    archivedAt: row.archived_at,
    automationRules,
    displayTargets: parseSupportMarkLocations(JSON.parse(row.display_locations_json)).map(location=>location==='friends'?'friend_list':location),
  };
}
