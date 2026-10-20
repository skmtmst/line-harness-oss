export { starter } from './style-starter-set.js';
import { starter } from './style-starter-set.js';
import { type AccountStyle, type SetupAnswer } from '@line-crm/shared';
import { storeFeatureInitialization } from '@line-crm/db/src/store-feature-initialization.js';

export * from './style-setup-core.js';
export * from './style-starter-definition.js';
export { featureReadiness, styleWarnings } from './style-readiness.js';
import { StyleError, checkStyle, readAnswers } from './style-setup-core.js';
import { readDefinition, standardStarter } from './style-starter-definition.js';
import { insertStyleStarterItems } from './style-starter-insert.js';
export {profile,profileAnswers,type StyleProfile} from './style-profile.js';
import {profile,profileAnswers} from './style-profile.js';
function assertVersion(expected: unknown, actual: number) {
  if (!Number.isInteger(expected) || expected !== actual)
    throw new StyleError('version_conflict', 409);
}
export async function saveProfile(
  db: D1Database,
  account: string,
  tenant: string | null,
  actor: string,
  input: Record<string, unknown>,
) {
  const current = await profile(db, account);
  assertVersion(input.expectedVersion, current?.version ?? 0);
  const submittedAnswers =
    input.answers === undefined ? {} : readAnswers(input.answers);
  const chosenStyle =
    submittedAnswers.style?.mode === 'configured'
      ? submittedAnswers.style.value
      : undefined;
  if (chosenStyle !== undefined) {
    checkStyle(chosenStyle);
    if (input.style !== undefined && input.style !== chosenStyle)
      throw new StyleError('invalid_style');
  }
  const style = checkStyle(
    input.style ?? chosenStyle ?? current?.style ?? 'standard',
  );
  const answers = {
    ...JSON.parse(current?.answers_json ?? '{}'),
    ...submittedAnswers,
  } as Record<string, SetupAnswer>;
  const styleMode =
    input.styleMode ??
    submittedAnswers.style?.mode ??
    (input.style !== undefined
      ? 'configured'
      : (current?.selection_mode ?? 'later'));
  if (!['configured', 'later', 'manual'].includes(styleMode as string))
    throw new StyleError('invalid_style_mode');
  const selected = styleMode === 'configured';
  if (
    submittedAnswers.style &&
    input.styleMode !== undefined &&
    input.styleMode !== submittedAnswers.style.mode
  )
    throw new StyleError('invalid_style_mode');
  answers.style = {
    mode: styleMode as SetupAnswer['mode'],
    ...(selected ? { value: style } : {}),
  };
  const now = new Date().toISOString(),
    version = (current?.version ?? 0) + 1;
  const settings = { ...JSON.parse(current?.settings_json ?? '{}') };
  if (input.settings !== undefined) {
    if (
      !input.settings ||
      typeof input.settings !== 'object' ||
      Array.isArray(input.settings)
    )
      throw new StyleError('invalid_settings');
    for (const [k, v] of Object.entries(input.settings)) {
      if (
        ![
          'returnDays',
          'recallFallbackDays',
          'recallMultiplier',
          'inactiveDays',
          'nextBookingHours',
          'noShowDays',
          'minimumSample',
        ].includes(k) ||
        typeof v !== 'number' ||
        !Number.isFinite(v) ||
        v <= 0 ||
        v > 365
      )
        throw new StyleError('invalid_settings');
      settings[k] = v;
    }
  }
  const cards = current?.style === style ? current.cards_json : null;
  const statements: D1PreparedStatement[] = [];
  // A failed compare-and-swap aborts the whole D1 batch, including created samples.
  statements.push(
    db
      .prepare(
        `SELECT json(CASE WHEN COALESCE((SELECT version FROM account_styles WHERE line_account_id=?),0)=? THEN '{}' ELSE 'STYLE_VERSION_CONFLICT' END)`,
      )
      .bind(account, current?.version ?? 0),
  );
  statements.push(
    db
      .prepare(
        `INSERT INTO account_styles(line_account_id,style,answers_json,cards_json,settings_json,version,updated_at,updated_by,selected_at,selection_mode) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(line_account_id) DO UPDATE SET style=excluded.style,answers_json=excluded.answers_json,cards_json=excluded.cards_json,settings_json=excluded.settings_json,version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by,selected_at=excluded.selected_at,selection_mode=excluded.selection_mode`,
      )
      .bind(
        account,
        style,
        JSON.stringify(answers),
        cards,
        JSON.stringify(settings),
        version,
        now,
        actor,
        selected ? now : null,
        styleMode,
      ),
  );
  const previousAnswers = JSON.parse(current?.answers_json ?? '{}') as Record<
    string,
    SetupAnswer
  >;
  statements.push(
    storeFeatureInitialization(db, account, tenant, actor, Date.parse(now)),
  );
  const changedAnswers = Object.fromEntries(
    Object.entries(submittedAnswers).filter(
      ([key, value]) =>
        JSON.stringify(previousAnswers[key]) !== JSON.stringify(value),
    ),
  );
  // Saving answers never writes live reservation settings. UI confirms these changes through the existing versioned settings API.
  const bookingSettingsChanges = Object.entries(changedAnswers).map(
    ([key, answer]) => ({ key, answer }),
  );
  const { set, inserted } = await insertStyleStarterItems(
    db,
    account,
    tenant,
    actor,
    input,
    selected,
    style,
    answers,
    statements,
    now,
  );
  statements.push(
    db
      .prepare(
        'INSERT INTO style_change_logs(id,line_account_id,actor_id,action,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?)',
      )
      .bind(
        crypto.randomUUID(),
        account,
        actor,
        'profile.save',
        current ? JSON.stringify(current) : null,
        JSON.stringify({ style, answers, version }),
        now,
      ),
  );
  try {
    await db.batch(statements);
  } catch (e) {
    if (String(e).includes('malformed JSON'))
      throw new StyleError('version_conflict', 409);
    throw e;
  }
  return {
    style,
    styleMode,
    styleSelected: selected,
    answers,
    settings,
    changedAnswers,
    bookingSettingsChanges,
    version,
    inserted,
    starterSet: { id: set.id, version: set.version },
  };
}
/** Called by account creation after ownership and connection validation, never by a read. */
export async function initializeAccountStyle(
  db: D1Database,
  account: string,
  tenant: string | null,
  actor: string,
  selectedStyle?: AccountStyle,
) {
  if (selectedStyle !== undefined) {
    return saveProfile(db, account, tenant, actor, { expectedVersion: 0, style: checkStyle(selectedStyle) });
  }
  const saved = await saveProfile(db, account, tenant, actor, {
    expectedVersion: 0,
    style: 'standard',
  });
  await db
    .prepare(
      `UPDATE account_styles SET selected_at=NULL,selection_mode='later',answers_json=json_set(answers_json,'$.style',json('{"mode":"later"}')) WHERE line_account_id=? AND version=1`,
    )
    .bind(account)
    .run();
  return saved;
}
