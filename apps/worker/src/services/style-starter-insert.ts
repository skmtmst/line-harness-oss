import {prepareStarterInsert} from './style-starter-insert-context.js';
import { styleMenuButtons } from './style-menu-buttons.js';
import {
  recordSnapshot,
  resourceSnapshot,
  overwriteResource,
  snapshotGuard,
} from './style-starter-resource.js';
import { type AccountStyle, type SetupAnswer } from '@line-crm/shared';

import { profile } from './style-profile.js';
import type { starter } from './style-starter-set.js';
import { StyleError, readCards, defaultCards } from './style-setup-core.js';
export async function insertStyleStarterItems(
  db: D1Database,
  account: string,
  tenant: string | null,
  actor: string,
  input: Record<string, unknown>,
  selected: boolean,
  style: AccountStyle,
  answers: Record<string, SetupAnswer>,
  statements: D1PreparedStatement[],
  now: string,
  options: {
    set?: Awaited<ReturnType<typeof starter>>;
    skipExisting?: boolean;
  } = {},
) {
  const {set,existing,oldProfile,choice}=await prepareStarterInsert(db,account,tenant,style,input,options);
  const inserted:unknown[]=[];
  for (const item of selected ? set.definition.items : []) {
    if (item.kind === 'booking_menu' && !['salon', 'consult'].includes(style))
      continue;
    if (!set.autoInsert && !choice?.[item.key]) continue;
    if (
      options.skipExisting !== false &&
      existing.some((e) => e.item_key === item.key)
    ) {
      if (!choice?.[item.key] || choice[item.key].mode === 'sample') {
        const old = existing.find((e) => e.item_key === item.key)!;
        // Reuse the same untouched resource across styles, while refreshing its industry contents.
        if (
          oldProfile?.style !== style &&
          old.kind === item.kind &&
          old.is_sample &&
          old.source_snapshot &&
          ['template', 'rich_menu'].includes(item.kind) &&
          (!answers.content || (answers.content.mode === 'configured' && answers.content.value !== false))
        ) {
          const snapshot = await resourceSnapshot(
            db,
            account,
            old.kind,
            old.target_id,
          );
          if (snapshot === old.source_snapshot) {
            statements.push(
              snapshotGuard(db, account, old.kind, old.target_id, snapshot),
            );
            statements.push(
              ...(await overwriteResource(
                db,
                account,
                old.target_id,
                item,
                now,
                style,
                answers,
              )),
            );
            statements.push(
              db
                .prepare(
                  'UPDATE style_starter_items SET set_id=?,set_version=? WHERE line_account_id=? AND item_key=?',
                )
                .bind(set.id, set.version, account, item.key),
            );
            statements.push(
              recordSnapshot(
                db,
                account,
                old.style,
                item.key,
                old.kind,
                old.target_id,
              ),
            );
          }
        }
        continue;
      }
      statements.push(
        db
          .prepare(
            'DELETE FROM style_starter_items WHERE line_account_id=? AND item_key=?',
          )
          .bind(account, item.key),
      );
    }
    if (
      ['template', 'rich_menu'].includes(item.kind) &&
      answers.content &&
      (answers.content.mode !== 'configured' || answers.content.value === false)
    )
      continue;
    const intrinsicFeature =
      item.kind === 'booking_menu'
        ? 'booking'
        : ['automation', 'reminder'].includes(item.kind)
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
            : item.kind === 'reminder'
              ? 'reminders'
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
            `INSERT INTO automation_versions(id,automation_id,version_number,status,trigger_type,trigger_config,condition_config,action_config,created_by) VALUES(?,?,1,'draft',?,'{}','{}',?,?)`,
          )
          .bind(
            draftId,
            id,
            item.triggerType ?? 'calendar_booked',
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
    } else if (item.kind === 'reminder') {
      const v = crypto.randomUUID(),
        step = crypto.randomUUID();
      const settings = {
        stopConditions: {
          bookingCancelled: true,
          supportMarkCompleted: false,
          daysAfterTarget: null,
          friendBlocked: true,
        },
        steps: [
          {
            stableStepId: step,
            offsetDays: item.offsetDays ?? null,
            sendAtTime: item.sendAtTime ?? null,
            offsetMinutes: item.offsetMinutes ?? -1440,
            messageType: 'text',
            messageContent: JSON.stringify({ text: item.text ?? item.name }),
          },
        ],
        lineAccountId: account,
        name: '【見本】' + item.name,
        description: null,
        triggerType: style === 'lesson' ? 'event' : 'booking',
        triggerOffsetMinutes: null,
        sendAtTime: null,
        targetTagId: null,
        folderId: null,
        deliveryMode: 'countdown',
        triggerFieldId: null,
        repeatYearly: false,
        leapYearPolicy: 'mar1',
        triggerEventId: null,
        isActive: false,
      };
      statements.push(
        db
          .prepare(
            `INSERT INTO reminders(id,line_account_id,name,is_active,lifecycle_status,trigger_type,current_draft_version_id) VALUES(?,?,?,0,'draft',?,?)`,
          )
          .bind(id, account, settings.name, settings.triggerType, v),
      );
      statements.push(
        db
          .prepare(
            `INSERT INTO reminder_versions(id,reminder_id,version_number,status,settings_snapshot,created_at,updated_at) VALUES(?,?,1,'draft',?,?,?)`,
          )
          .bind(v, id, JSON.stringify(settings), now, now),
      );
      statements.push(
        db
          .prepare(
            `INSERT INTO reminder_version_steps(id,reminder_version_id,stable_step_id,position,offset_minutes,offset_days,send_at_time,message_type,message_content,created_at) VALUES(?,?,?,0,?,?,?,'text',?,?)`,
          )
          .bind(
            crypto.randomUUID(),
            v,
            step,
            item.offsetMinutes ?? -1440,
            item.offsetDays ?? null,
            item.sendAtTime ?? null,
            JSON.stringify({ text: item.text ?? item.name }),
            now,
          ),
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
      for (const [i, button] of (
        await styleMenuButtons(db, account, style, item, answers)
      ).entries()) {
        const { actionType, actionData, intent } = button;
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
    statements.push(
      recordSnapshot(db, account, style, item.key, item.kind, id),
    );
    inserted.push({
      key: item.key,
      name: item.name,
      definition: item,
      setId: set.id,
      setVersion: set.version,
      kind: item.kind,
      id,
      isSample: sample,
      requiresActivation:
        item.kind === 'automation' ||
        item.kind === 'reminder' ||
        item.kind === 'booking_menu' ||
        item.kind === 'rich_menu',
    });
  }
  return { set, inserted };
}
