import { validateStampSettings } from './visit-stamps.js';

import type { VisitStampSettings } from '@line-crm/shared';

import { StyleError, features, featureLink, questionsForStyle } from './style-setup-core.js';
import { profile, profileAnswers } from './style-setup.js';
export async function featureReadiness(
  db: D1Database,
  account: string,
  feature: string,
) {
  const p = await profile(db, account),
    answers = profileAnswers(p);
  if (!Object.hasOwn(features, feature))
    throw new StyleError('invalid_feature');
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
    ...featureLink(feature),
  };
}
export async function styleWarnings(db: D1Database, account: string) {
  const p = await profile(db, account),
    answers = profileAnswers(p);
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
        ...featureLink(feature),
        customerState: 'preparing',
      });
  }
  return {
    count: warnings.length,
    items: warnings,
    pending: questionsForStyle(p?.style ?? 'standard')
      .filter((k) => !answers[k] || answers[k].mode === 'later')
      .map((key) => ({
        key,
        ...featureLink(key),
        mode: answers[key]?.mode ?? 'later',
      })),
    manual: questionsForStyle(p?.style ?? 'standard')
      .filter((k) => answers[k]?.mode === 'manual')
      .map((key) => ({ key, ...featureLink(key) })),
  };
}
