import { logger } from '@line-crm/shared/server';
import type { ApplyMileageRulesInput } from '@line-crm/db';

/** マイルの反映が使えなくても、利用者の主操作は成功させる。 */
export async function awardActivityMileage(
  db: D1Database,
  input: ApplyMileageRulesInput,
): Promise<void> {
  try {
    const { applyMileageRulesForEvent } = await import('@line-crm/db');
    await applyMileageRulesForEvent(db, input);
  } catch (error) {
    logger.error("mileage.award_activity_failed");
  }
}
