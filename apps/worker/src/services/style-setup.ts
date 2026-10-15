import { validateStampSettings } from './visit-stamps.js';
import { templateSamples } from './style-template-samples.js';
import type { VisitStampSettings } from '@line-crm/shared';
import {
  ACCOUNT_STYLES,
  DASHBOARD_CARD_GROUPS,
  liffActionUrl,
  type AccountStyle,
  type SetupAnswer,
  type StyleCard,
} from '@line-crm/shared';

export class StyleError extends Error {
  constructor(
    public code: string,
    public status: 400 | 403 | 404 | 409 | 422 = 400,
  ) {
    super(code);
  }
}
export const checkStyle = (style: unknown): AccountStyle => {
  if (!ACCOUNT_STYLES.includes(style as AccountStyle))
    throw new StyleError('invalid_style');
  return style as AccountStyle;
};
export const questionKeys = [
  'image',
  'booking',
  'approval',
  'payment',
  'reminders',
  'stamps',
  'coupons',
  'tickets',
  'outcome',
  'content',
] as const;
export const features: Record<string, string> = {
  booking: '/booking/settings',
  approval: '/booking/settings',
  payment: '/booking/settings?tab=payment',
  reminders: '/booking/settings',
  stamps: '/visit-stamps',
  coupons: '/coupons',
  tickets: '/booking/tickets',
  image: '/rich-menus',
  outcome: '/booking/settings',
  content: '/rich-menus',
};
export function readAnswers(input: unknown): Record<string, SetupAnswer> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new StyleError('invalid_answers');
  const out: Record<string, SetupAnswer> = {};
  for (const [key, value] of Object.entries(input)) {
    const answer = value as SetupAnswer;
    if (
      !questionKeys.includes(key as (typeof questionKeys)[number]) ||
      !answer ||
      !['configured', 'later', 'manual'].includes(answer.mode) ||
      (answer.value !== undefined &&
        typeof answer.value !== 'string' &&
        typeof answer.value !== 'boolean') ||
      (typeof answer.value === 'string' && answer.value.length > 500) ||
      (answer.resourceId !== undefined && typeof answer.resourceId !== 'string')
    )
      throw new StyleError('invalid_answers');
    out[key] = {
      mode: answer.mode,
      ...(answer.value !== undefined ? { value: answer.value } : {}),
      ...(answer.resourceId ? { resourceId: answer.resourceId } : {}),
    };
  }
  return out;
}
export function defaultCards(style: AccountStyle): StyleCard[] {
  const main: Record<AccountStyle, string[]> = {
    standard: ['getting-started', 'inbox', 'deliveries'],
    ec: ['getting-started', 'ec-orders', 'ec-repeat'],
    restaurant: ['today-seats', 'reservations', 'customers', 'analytics'],
    salon: ['ledger', 'reservations', 'customers', 'analytics'],
    consult: [
      'consultations',
      'results-pending',
      'customers',
      'staff',
      'analytics',
    ],
    lesson: ['classes', 'members', 'trials', 'analytics'],
  };
  return [
    { id: 'connection-alert', visible: true },
    ...(style === 'restaurant'
      ? [{ id: 'channel-close-alert', visible: true }]
      : []),
    ...main[style].map((id) => ({ id, visible: true })),
  ];
}
export function readCards(input: unknown, style: AccountStyle): StyleCard[] {
  if (!Array.isArray(input) || input.length > 50)
    throw new StyleError('invalid_cards');
  const allowed = new Set([
      ...defaultCards(style).map((c) => c.id),
      ...Object.values(DASHBOARD_CARD_GROUPS).flat(),
    ]),
    seen = new Set<string>(),
    out: StyleCard[] = [];
  for (const c of input) {
    if (
      !c ||
      !allowed.has(c.id) ||
      seen.has(c.id) ||
      typeof c.visible !== 'boolean'
    )
      throw new StyleError('invalid_cards');
    seen.add(c.id);
    if (c.id.endsWith('-alert') && !c.visible)
      throw new StyleError('mandatory_alert');
    out.push({ id: c.id, visible: c.visible });
  }
  for (const c of defaultCards(style))
    if (!seen.has(c.id)) out.push({ ...c, visible: c.id.endsWith('-alert') });
  return out;
}
export type StarterItem = {
  key: string;
  kind: 'template' | 'rich_menu' | 'automation' | 'booking_menu' | 'dashboard';
  name: string;
  feature?: string;
  text?: string;
  durationMinutes?: number;
  price?: number;
  buttons?: Array<{ label: string; feature: string }>;
  cards?: StyleCard[];
  sourceId?: string;
};
export type StarterDefinition = { items: StarterItem[] };
export function standardStarter(style: AccountStyle): StarterDefinition {
  const names: Record<AccountStyle, string> = {
    standard: 'ご案内',
    ec: 'お買い物',
    restaurant: 'お店',
    salon: 'サロン',
    consult: 'ご相談',
    lesson: 'レッスン',
  };
  return {
    items: [
      {
        key: 'welcome',
        kind: 'template',
        name: `${names[style]}のごあいさつ`,
        text: `こんにちは。${names[style]}へのお問い合わせありがとうございます。ご希望をお知らせください。`,
      },
      {
        key: 'menu',
        kind: 'rich_menu',
        name: `${names[style]}のメニュー`,
        buttons: [
          { label: '予約する', feature: 'booking' },
          { label: 'ポイントカード', feature: 'stamps' },
          { label: 'お問い合わせ', feature: 'contact' },
        ],
      },
      {
        key: 'booking',
        kind: 'booking_menu',
        feature: 'booking',
        name: `${names[style]}の予約`,
        durationMinutes: 60,
        price: 0,
      },
      {
        key: 'reminder',
        kind: 'automation',
        feature: 'reminders',
        name: '予約確定のご案内',
        text: 'ご予約ありがとうございます。日時をご確認ください。',
      },
      {
        key: 'dashboard',
        kind: 'dashboard',
        name: 'ダッシュボードの型',
        cards: defaultCards(style),
      },
      ...templateSamples(style).map((sample) => sample.starterItem),
    ],
  };
}
export function readDefinition(
  value: unknown,
  style: AccountStyle,
): StarterDefinition {
  const input = value as StarterDefinition;
  if (!input || !Array.isArray(input.items) || input.items.length > 30)
    throw new StyleError('invalid_starter_set');
  const seen = new Set<string>();
  for (const item of input.items) {
    if (
      !item ||
      typeof item.key !== 'string' ||
      !/^[a-z0-9_-]{1,64}$/.test(item.key) ||
      seen.has(item.key) ||
      ![
        'template',
        'rich_menu',
        'automation',
        'booking_menu',
        'dashboard',
      ].includes(item.kind) ||
      typeof item.name !== 'string' ||
      !item.name.trim() ||
      item.name.length > 100 ||
      (item.feature && !features[item.feature]) ||
      (item.text !== undefined &&
        (typeof item.text !== 'string' || item.text.length > 2000)) ||
      (item.durationMinutes !== undefined &&
        (!Number.isInteger(item.durationMinutes) ||
          item.durationMinutes < 5 ||
          item.durationMinutes > 1440)) ||
      (item.price !== undefined &&
        (!Number.isInteger(item.price) || item.price < 0)) ||
      (item.sourceId !== undefined && typeof item.sourceId !== 'string')
    )
      throw new StyleError('invalid_starter_set');
    if (
      item.buttons &&
      (!Array.isArray(item.buttons) ||
        item.buttons.length > 6 ||
        item.buttons.some(
          (b) =>
            typeof b.label !== 'string' ||
            b.label.length > 50 ||
            (!features[b.feature] && b.feature !== 'contact'),
        ))
    )
      throw new StyleError('invalid_buttons');
    if (item.cards) readCards(item.cards, style);
    seen.add(item.key);
  }
  return input;
}
export type StyleProfile = {
  line_account_id: string;
  style: AccountStyle;
  answers_json: string;
  cards_json: string | null;
  settings_json: string;
  selected_at: string | null;
  version: number;
  updated_at: string;
};
export async function profile(db: D1Database, account: string) {
  return db
    .prepare('SELECT * FROM account_styles WHERE line_account_id=?')
    .bind(account)
    .first<StyleProfile>();
}
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
    .first<{ id: string; version: number; definition_json: string }>();
  return saved
    ? {
        id: saved.id,
        version: saved.version,
        definition: readDefinition(JSON.parse(saved.definition_json), style),
      }
    : { id: 'musubo:' + style, version: 1, definition: standardStarter(style) };
}
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
  const style =
    input.style === undefined
      ? (current?.style ?? 'standard')
      : checkStyle(input.style);
  const answers = {
    ...JSON.parse(current?.answers_json ?? '{}'),
    ...(input.answers === undefined ? {} : readAnswers(input.answers)),
  } as Record<string, SetupAnswer>;
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
        `INSERT INTO account_styles(line_account_id,style,answers_json,cards_json,settings_json,version,updated_at,updated_by,selected_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(line_account_id) DO UPDATE SET style=excluded.style,answers_json=excluded.answers_json,cards_json=excluded.cards_json,settings_json=excluded.settings_json,version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by,selected_at=excluded.selected_at`,
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
        now,
      ),
  );
  if (answers.approval?.mode === 'configured') {
    const mode =
      answers.approval.value === true || answers.approval.value === 'manual'
        ? 'manual'
        : 'automatic';
    statements.push(
      db
        .prepare(
          `INSERT INTO booking_settings(id,line_account_id,approval_mode) VALUES(?,?,?) ON CONFLICT(line_account_id) DO UPDATE SET approval_mode=excluded.approval_mode,version=booking_settings.version+1`,
        )
        .bind(crypto.randomUUID(), account, mode),
    );
  }
  const set = await starter(db, tenant, style),
    inserted: unknown[] = [];
  const existing = (
    await db
      .prepare(
        'SELECT * FROM style_starter_items WHERE line_account_id=? AND style=?',
      )
      .bind(account, style)
      .all<{ item_key: string; target_id: string; kind: string }>()
  ).results;
  const choice = input.choices as
    | Record<
        string,
        { mode: 'sample' | 'existing' | 'configured'; resourceId?: string }
      >
    | undefined;
  if (
    choice !== undefined &&
    (!choice || typeof choice !== 'object' || Array.isArray(choice))
  )
    throw new StyleError('invalid_choices');
  for (const item of set.definition.items) {
    if (existing.some((e) => e.item_key === item.key)) continue;
    if(['template','rich_menu'].includes(item.kind)&&answers.content&&answers.content.mode!=='configured')continue;
    const intrinsicFeature =
      item.kind === 'booking_menu'
        ? 'booking'
        : item.kind === 'automation'
          ? 'reminders'
          : undefined;
    const requiredFeatures = [item.feature, intrinsicFeature].filter(
      (feature): feature is string => !!feature,
    );
    if (
      requiredFeatures.some(
        (feature) =>
          answers[feature]?.mode !== 'configured' ||
          answers[feature]?.value === false,
      )
    )
      continue;
    const chosen = choice?.[item.key];
    if (chosen && !['sample', 'existing', 'configured'].includes(chosen.mode))
      throw new StyleError('invalid_choices');
    let id = crypto.randomUUID(),
      sample = true;
    const table =
      item.kind === 'template'
        ? 'templates'
        : item.kind === 'rich_menu'
          ? 'rich_menu_groups'
          : item.kind === 'automation'
            ? 'automation_definitions'
            : item.kind === 'booking_menu'
              ? 'menus'
              : null;
    const accountColumn =
      item.kind === 'rich_menu' ? 'account_id' : 'line_account_id';
    if (chosen && chosen.mode !== 'sample') {
      if (!table || !chosen.resourceId)
        throw new StyleError('invalid_resource');
      const source = await db
        .prepare(`SELECT id FROM ${table} WHERE id=? AND ${accountColumn}=?`)
        .bind(chosen.resourceId, account)
        .first<{ id: string }>();
      if (!source) throw new StyleError('resource_not_found', 404);
      id = source.id;
      sample = false;
    } else if (item.sourceId) {
      // Cross-account cloning belongs to the existing HQ distribution mechanism. Never copy live IDs.
      throw new StyleError('use_hq_distribution_for_source', 422);
    } else if (item.kind === 'template')
      statements.push(
        db
          .prepare(
            `INSERT INTO templates(id,line_account_id,name,message_type,message_content) VALUES(?,?,?,'text',?)`,
          )
          .bind(
            id,
            account,
            '【見本】' + item.name,
            JSON.stringify({ text: item.text ?? item.name }),
          ),
      );
    else if (item.kind === 'automation') {
      const draftId = crypto.randomUUID();
      statements.push(
        db
          .prepare(
            `INSERT INTO automation_definitions(id,line_account_id,name,status,created_by) VALUES(?,?,?,'draft',?)`,
          )
          .bind(id, account, '【見本】' + item.name, actor),
      );
      statements.push(
        db
          .prepare(
            `INSERT INTO automation_versions(id,automation_id,version_number,status,trigger_type,trigger_config,condition_config,action_config,created_by) VALUES(?,?,1,'draft','calendar_booked','{}','{}',?,?)`,
          )
          .bind(
            draftId,
            id,
            JSON.stringify([
              {
                id: 'message',
                type: 'send_message',
                params: {
                  messageType: 'text',
                  content: item.text ?? item.name,
                },
                onFailure: 'stop',
              },
            ]),
            actor,
          ),
      );
      statements.push(
        db
          .prepare(
            'UPDATE automation_definitions SET current_draft_version_id=? WHERE id=?',
          )
          .bind(draftId, id),
      );
    } else if (item.kind === 'booking_menu')
      statements.push(
        db
          .prepare(
            `INSERT INTO menus(id,line_account_id,name,duration_minutes,base_price,is_active) VALUES(?,?,?,?,?,0)`,
          )
          .bind(
            id,
            account,
            '【見本】' + item.name,
            item.durationMinutes ?? 60,
            item.price ?? 0,
          ),
      );
    else if (item.kind === 'rich_menu') {
      const page = crypto.randomUUID();
      statements.push(
        db
          .prepare(
            `INSERT INTO rich_menu_groups(id,account_id,name,chat_bar_text,size,status) VALUES(?,?,?,'メニュー','large','draft')`,
          )
          .bind(id, account, '【見本】' + item.name),
      );
      statements.push(
        db
          .prepare(
            `INSERT INTO rich_menu_pages(id,group_id,order_index,name,alias_id) VALUES(?,?,0,'メニュー',?)`,
          )
          .bind(page, id, 'style-' + page),
      );
      if (answers.image?.mode === 'configured' && answers.image.resourceId) {
        const image = await db
          .prepare(
            `SELECT p.image_r2_key,p.image_content_type FROM rich_menu_pages p JOIN rich_menu_groups g ON g.id=p.group_id WHERE p.id=? AND g.account_id=? AND p.image_r2_key IS NOT NULL`,
          )
          .bind(answers.image.resourceId, account)
          .first<{ image_r2_key: string; image_content_type: string | null }>();
        if (!image) throw new StyleError('image_not_found', 404);
        statements.push(
          db
            .prepare(
              'UPDATE rich_menu_pages SET image_r2_key=?,image_content_type=? WHERE id=?',
            )
            .bind(image.image_r2_key, image.image_content_type, page),
        );
      }
      const lineAccount = await db
        .prepare('SELECT liff_id FROM line_accounts WHERE id=?')
        .bind(account)
        .first<{ liff_id: string | null }>();
      for (const [i, button] of (item.buttons ?? []).entries()) {
        // Unconfigured features are omitted; the warning API still catches pre-existing buttons.
        if (
          button.feature !== 'contact' &&
          (answers[button.feature]?.mode !== 'configured' ||
            answers[button.feature]?.value === false)
        )
          continue;
        let actionType = 'message',
          actionData = button.label,
          intent = 'text';
        if (
          lineAccount?.liff_id &&
          ['booking', 'stamps'].includes(button.feature)
        ) {
          if (button.feature === 'stamps')
            actionData = liffActionUrl({
              kind: 'visit_stamp',
              liffId: lineAccount.liff_id,
            });
          else if (style === 'restaurant') {
            const link = await db
              .prepare(
                'SELECT l.token FROM rt_reservation_links l JOIN rt_stores s ON s.id=l.store_id WHERE s.line_account_id=? LIMIT 1',
              )
              .bind(account)
              .first<{ token: string }>();
            if (!link) continue;
            actionData = `https://liff.line.me/${encodeURIComponent(lineAccount.liff_id)}?${new URLSearchParams({ page: 'restaurant', token: link.token })}`;
          } else if (style === 'lesson')
            actionData = `https://liff.line.me/${encodeURIComponent(lineAccount.liff_id)}?page=event`;
          else
            actionData = liffActionUrl({
              kind: 'booking',
              liffId: lineAccount.liff_id,
            });
          actionType = 'uri';
          intent = 'url';
        }
        statements.push(
          db
            .prepare(
              `INSERT INTO rich_menu_areas(id,page_id,bounds_x,bounds_y,bounds_width,bounds_height,action_type,action_data,intent,label) VALUES(?,?,?,?,833,843,?,?,?,?)`,
            )
            .bind(
              crypto.randomUUID(),
              page,
              (i % 3) * 833,
              Math.floor(i / 3) * 843,
              actionType,
              actionData,
              intent,
              button.label,
            ),
        );
      }
      statements.push(
        db
          .prepare('UPDATE rich_menu_groups SET default_page_id=? WHERE id=?')
          .bind(page, id),
      );
    } else if (item.kind === 'dashboard')
      statements.push(
        db
          .prepare(
            'UPDATE account_styles SET cards_json=? WHERE line_account_id=? AND cards_json IS NULL',
          )
          .bind(
            JSON.stringify(readCards(item.cards ?? defaultCards(style), style)),
            account,
          ),
      );
    statements.push(
      db
        .prepare(
          `INSERT INTO style_starter_items(line_account_id,style,item_key,kind,target_id,is_sample,feature,set_id,set_version,applied_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          account,
          style,
          item.key,
          item.kind,
          id,
          Number(sample),
          item.feature ?? intrinsicFeature ?? null,
          set.id,
          set.version,
          now,
        ),
    );
    inserted.push({
      key: item.key,
      kind: item.kind,
      id,
      isSample: sample,
      requiresActivation:
        item.kind === 'automation' ||
        item.kind === 'booking_menu' ||
        item.kind === 'rich_menu',
    });
  }
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
    answers,
    settings,
    version,
    inserted,
    starterSet: { id: set.id, version: set.version },
  };
}
export async function featureReadiness(
  db: D1Database,
  account: string,
  feature: string,
) {
  const p = await profile(db, account),
    answers: Record<string, SetupAnswer> = JSON.parse(p?.answers_json ?? '{}');
  if (!features[feature]) throw new StyleError('invalid_feature');
  let configured =
    answers[feature]?.mode === 'configured' &&
    answers[feature]?.value !== false;
  if (feature === 'booking') {
    configured = !!(await db
      .prepare(
        `SELECT 1 FROM menus m JOIN booking_settings s ON s.line_account_id=m.line_account_id WHERE m.line_account_id=? AND m.is_active=1 AND m.deleted_at IS NULL AND s.business_hours_configured=1 LIMIT 1`,
      )
      .bind(account)
      .first());
  }
  if (feature === 'stamps') {
    const cards = (
      await db
        .prepare(
          `SELECT c.settings_json FROM visit_stamp_cards c JOIN visit_stamp_card_accounts ca ON ca.card_id=c.id WHERE ca.line_account_id=? AND c.active=1`,
        )
        .bind(account)
        .all<{ settings_json: string }>()
    ).results;
    configured = cards.some((card) => {
      try {
        validateStampSettings(
          JSON.parse(card.settings_json) as VisitStampSettings,
        );
        return true;
      } catch {
        return false;
      }
    });
  }

  return {
    feature,
    ready: configured,
    state: configured ? 'ready' : 'preparing',
    message: configured ? null : '現在準備中です',
    href: features[feature],
  };
}
export async function styleWarnings(db: D1Database, account: string) {
  const p = await profile(db, account),
    answers: Record<string, SetupAnswer> = JSON.parse(p?.answers_json ?? '{}');
  const areas = (
    await db
      .prepare(
        `SELECT a.id,a.label,a.intent,a.action_data,a.template_id,a.form_id,g.id groupId FROM rich_menu_areas a JOIN rich_menu_pages p ON p.id=a.page_id JOIN rich_menu_groups g ON g.id=p.group_id WHERE g.account_id=?`,
      )
      .bind(account)
      .all<{
        id: string;
        label: string;
        intent: string;
        action_data: string;
        template_id: string | null;
        form_id: string | null;
        groupId: string;
      }>()
  ).results;
  const warnings = [];
  for (const area of areas) {
    const text = [area.label, area.intent, area.action_data].join(' ');
    const feature = /stamp|ポイント|スタンプ/.test(text)
      ? 'stamps'
      : /ticket|回数券/.test(text)
        ? 'tickets'
        : /coupon|クーポン/.test(text)
          ? 'coupons'
          : /booking|予約/.test(text)
            ? 'booking'
            : null;
    if (feature && !(await featureReadiness(db, account, feature)).ready)
      warnings.push({
        feature,
        areaId: area.id,
        groupId: area.groupId,
        href: features[feature],
        customerState: 'preparing',
      });
  }
  return {
    count: warnings.length,
    items: warnings,
    pending: questionKeys
      .filter((k) => !answers[k] || answers[k].mode === 'later')
      .map((key) => ({
        key,
        href: features[key],
        mode: answers[key]?.mode ?? 'later',
      })),
    manual: questionKeys
      .filter((k) => answers[k]?.mode === 'manual')
      .map((key) => ({ key, href: features[key] })),
  };
}

/** Called by account creation after ownership and connection validation, never by a read. */
export async function initializeAccountStyle(
  db: D1Database,
  account: string,
  tenant: string | null,
  actor: string,
) {
  const saved = await saveProfile(db, account, tenant, actor, {
    expectedVersion: 0,
    style: 'standard',
  });
  await db
    .prepare(
      'UPDATE account_styles SET selected_at=NULL WHERE line_account_id=? AND version=1',
    )
    .bind(account)
    .run();
  return saved;
}
