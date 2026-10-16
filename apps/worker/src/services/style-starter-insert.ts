import { liffActionUrl, type AccountStyle, type SetupAnswer } from '@line-crm/shared';

import { starter, StyleError, readCards, defaultCards } from './style-setup.js';
export async function insertStyleStarterItems(db:D1Database,account:string,tenant:string|null,actor:string,input:Record<string,unknown>,selected:boolean,style:AccountStyle,answers:Record<string,SetupAnswer>,statements:D1PreparedStatement[],now:string) {
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
  for (const item of selected ? set.definition.items : []) {
    if (!set.autoInsert && !choice?.[item.key]) continue;
    if (existing.some((e) => e.item_key === item.key)) continue;
    if (
      ['template', 'rich_menu'].includes(item.kind) &&
      answers.content &&
      answers.content.mode !== 'configured'
    )
      continue;
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
return {set,inserted};
}
