import { getVersionedAccountSetting } from '@line-crm/db';
import { DEFAULT_ALLERGY_OPTIONS, validateAllergyValues, collectInputs, type FormLayout } from '@line-crm/shared';
export const ALLERGY_OPTIONS_KEY = 'friend.allergy_options_v1';
export async function accountAllergyOptions(db: D1Database, accountId: string) {
  const setting = await getVersionedAccountSetting<string[]>(db, accountId, ALLERGY_OPTIONS_KEY);
  const checked = validateAllergyValues(setting?.data);
  return { version: setting?.version ?? 0, options: setting && checked.ok ? checked.values : [...DEFAULT_ALLERGY_OPTIONS] };
}
/** 統括が配った型も、公開するときに配布先の選択肢を読む。 */
export async function applyAccountAllergyOptions(db: D1Database, accountId: string, layout: FormLayout): Promise<FormLayout> {
  if (!collectInputs(layout).some(block => block.fixedField === 'allergy' && block.type === 'checkbox')) return layout;
  const { options } = await accountAllergyOptions(db, accountId);
  const copy = structuredClone(layout);
  for (const block of collectInputs(copy)) {
    if (block.fixedField !== 'allergy' || block.type !== 'checkbox') continue;
    block.choices = [...options.map((label, i) => ({ id: `allergy-${i}`, label })), { id:'allergy-other',label:'そのほか（自由に書く）',isOther:true }];
  }
  return copy;
}
