import { logger } from '@line-crm/shared/server';
import { serializeMark } from '../services/support-mark-display.js';
import { parseSupportMarkLocations } from '@line-crm/shared';
import { inputError } from '../lib/input-errors.js';

import { restoreSupportMark, ArchiveRestoreError, getSupportMarksWithUsage, getSupportMarkArchiveImpact, getSupportMarkById, createSupportMarkIdempotent, SupportMarkCreateError, updateSupportMark, reorderSupportMarks, replaceAndArchiveSupportMark, archiveSupportMarkWithReplacement, SupportMarkArchiveError, getDefaultSupportMark, setFriendSupportMark } from '@line-crm/db';
import type { Env } from '../worker-env.js';

import { archiveSupportMarkAutomationRule, createSupportMarkAutomationRuleIdempotent, listSupportMarkAutomationRules, listSupportMarkAutomationRulesForAccount, SupportMarkRuleCreateError, updateSupportMarkAutomationRule, validateSupportMarkAutomationRuleInput, type SaveSupportMarkAutomationRule } from '../services/support-mark-automation.js';
import { supportMarkAccess, SUPPORT_MARK_NAME_MAX, COLOR_PATTERN, supportMarkRuleInput, markReferenceCount, serializeMarkImpact, sameMarkImpact } from './friend-attributes-definition.js';
import type { Context } from 'hono';

export const get__api_support_marks_1 = async (c: Context<Env, "/api/support-marks">) => {
  try {
    const scope = await supportMarkAccess(c);
    if (scope instanceof Response) return scope;
    const [marks, rules] = await Promise.all([
      getSupportMarksWithUsage(c.env.DB, scope, c.req.query('includeArchived') === '1'),
      listSupportMarkAutomationRulesForAccount(c.env.DB, scope),
    ]);
    const rulesByMark = new Map<string, typeof rules>();
    for (const rule of rules) {
      rulesByMark.set(rule.markId, [...(rulesByMark.get(rule.markId) ?? []), rule]);
    }
    const withCounts = marks.map((mark) => ({
        ...serializeMark(mark, rulesByMark.get(mark.id) ?? []),
        friendCount: Number(mark.friend_count),
        usedIn: {
          broadcasts: Number(mark.broadcasts),
          scenarios: Number(mark.scenarios),
          autoReplies: Number(mark.auto_replies),
          savedSearches: Number(mark.saved_searches),
          automations: Number(mark.automations),
        },
      }));
    return c.json({ success: true, data: withCounts });
  } catch (err) {
    logger.error("routes_friend_attributes_failed");
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
};

export const post__api_support_marks_id_restore_2 = async (c: Context<Env, "/api/support-marks/:id/restore">) => {
  try {
    const scope = await supportMarkAccess(c);
    if (scope instanceof Response) return scope;
    const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
    const expectedVersion = body.expectedVersion;
    if (typeof expectedVersion !== 'number' || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return c.json({ success: false, error: 'expectedVersion is required', fields: { expectedVersion: '最新の版を読み込んでください' } }, 400);
    }
    return c.json({ success: true, data: await restoreSupportMark(c.env.DB, scope, { id: c.req.param('id'), expectedVersion, actorId: c.get('staff').id }) });
  } catch (error) {
    if (error instanceof ArchiveRestoreError) return c.json({ success: false, code: error.code, error: error.code === 'not_found' ? '対象が見つかりません' : '状態が変わりました。もう一度読み込んでください' }, error.code === 'not_found' ? 404 : 409);
    logger.error("routes_friend_attributes_failed");
    return c.json({ success: false, error: '保管から戻せませんでした' }, 500);
  }
};

export const post__api_support_marks_3 = async (c: Context<Env, "/api/support-marks">) => {
  try {
    const scope = await supportMarkAccess(c);
    if (scope instanceof Response) return scope;
    /*
     * R512: 応答だけ失った再試行で二重に作らないため、要求キーを必須にする。
     * 同じキー・同じ内容の再送は保存済みのマークを返し、同じキーに
     * 異なる内容が来たら作らず409で止める（保管の口と同じ約束）。
     */
    const idempotencyKey = c.req.header('Idempotency-Key')?.trim() ?? '';
    if (!idempotencyKey || idempotencyKey.length > 128) {
      return inputError(c, { success: false, error: 'Idempotency-Keyを指定してください' }, 400, []);
    }
    const body = await c.req.json<Record<string, unknown>>();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return inputError(c, { success: false, error: 'マークの名前を入力してください' }, 400, ["name"]);
    // D030: 長さの上限が無く、長い名前が一覧や配信設定の表示を壊す。作成と編集で同じ上限にする。
    if (name.length > SUPPORT_MARK_NAME_MAX) {
      return inputError(c, { success: false, error: `マークの名前は${SUPPORT_MARK_NAME_MAX}文字以内で入力してください` }, 400, ["name"]);
    }
    if (body.color !== undefined && !COLOR_PATTERN.test(String(body.color))) {
      return inputError(c, { success: false, error: '色は #RRGGBB の形で指定してください' }, 400, ["color"]);
    }
    const displayOrder = Number(body.displayOrder ?? 0);
    if (!Number.isInteger(displayOrder) || displayOrder < 0 || displayOrder > 10_000) {
      return inputError(c, { success: false, error: '並び順は0〜10000の整数で指定してください' }, 400, ["displayOrder"]);
    }
    const automationValues = body.automationRules ?? [];
    if (!Array.isArray(automationValues) || automationValues.length > 20) {
      return inputError(c, { success: false, error: '自動変更ルールは20件以内で指定してください' }, 400, ["automationRules"]);
    }
    const automationRules = automationValues.map((value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? supportMarkRuleInput(value as Record<string, unknown>)
        : null);
    if (automationRules.some((rule) => rule === null)) {
      return inputError(c, { success: false, error: '自動変更ルールの入力が正しくありません' }, 400, ["automationRules"]);
    }
    try {
      for (const rule of automationRules) validateSupportMarkAutomationRuleInput(rule!);
    } catch {
      return inputError(c, { success: false, error: '自動変更ルールの入力が正しくありません' }, 422, ["automationRules"]);
    }
    const { mark, replayed } = await createSupportMarkIdempotent(c.env.DB, scope, {
      name,
      color: body.color ? String(body.color) : undefined,
      isDefault: body.isDefault === true,
      autoOnInbound: body.autoOnInbound === true,
      displayOrder,
    }, c.get('staff').id, automationRules as SaveSupportMarkAutomationRule[], idempotencyKey);
    /*
     * D028: 書き込みは上の確定で終わっている。読み戻しだけ失敗したときに
     * 500で「失敗」と見せると、利用者が送り直して同名マークが増える。
     * 読めなくても作成自体は成功として返し、ルールは次の一覧読み直しで見える。
     */
    let createdRules: Awaited<ReturnType<typeof listSupportMarkAutomationRules>> = [];
    try {
      createdRules = await listSupportMarkAutomationRules(c.env.DB, scope, mark.id) ?? [];
    } catch (err) {
      logger.error("routes_friend_attributes_failed");
    }
    // 再送で保存済みを返したときは200、新しく作ったときは201。
    return c.json({ success: true, data: serializeMark(mark, createdRules) }, replayed ? 200 : 201);
  } catch (err) {
    if (err instanceof SupportMarkCreateError) {
      return c.json({ success: false, code: err.code, error: err.message }, 409);
    }
    logger.error("routes_friend_attributes_failed");
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
};

export const patch__api_support_marks_reorder_4 = async (c: Context<Env, "/api/support-marks/reorder">) => {
  try {
    const scope = await supportMarkAccess(c);
    if (scope instanceof Response) return scope;
    const body = await c.req.json<{ ids?: unknown }>();
    if (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== 'string')) {
      return inputError(c, { success: false, error: 'ids must be an array of mark ids' }, 400, ["ids"]);
    }
    if (body.ids.length > 500) {
      return inputError(c, { success: false, error: 'too many ids' }, 400, ["ids"]);
    }
    if (new Set(body.ids).size !== body.ids.length) {
      return inputError(c, { success: false, error: 'ids must not contain duplicates' }, 400, ["ids"]);
    }
    await reorderSupportMarks(c.env.DB, scope, body.ids as string[]);
    return c.json({ success: true, data: { updated: body.ids.length } });
  } catch (err) {
    logger.error("routes_friend_attributes_failed");
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
};

export const patch__api_support_marks_id_5 = async (c: Context<Env, "/api/support-marks/:id">) => {
  try {
    const scope = await supportMarkAccess(c);
    if (scope instanceof Response) return scope;
    const id = c.req.param('id');
    const existing = await getSupportMarkById(c.env.DB, id, scope);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);

    const body = await c.req.json<Record<string, unknown>>();
    if (body.color !== undefined && !COLOR_PATTERN.test(String(body.color))) {
      return inputError(c, { success: false, error: '色は #RRGGBB の形で指定してください' }, 400, ["color"]);
    }
    /*
     * D032: 作成（POST）と同じ検査を編集でもする。空名・長い名前・
     * 範囲外の順序は400で止め、型違いを500（DBの束縛失敗）にしない。
     */
    let name: string | undefined;
    if (body.name !== undefined) {
      if (typeof body.name !== 'string') {
        return inputError(c, { success: false, error: 'マークの名前を入力してください' }, 400, ["name"]);
      }
      name = body.name.trim();
      if (!name) return inputError(c, { success: false, error: 'マークの名前を入力してください' }, 400, ["name"]);
      if (name.length > SUPPORT_MARK_NAME_MAX) {
        return inputError(c, { success: false, error: `マークの名前は${SUPPORT_MARK_NAME_MAX}文字以内で入力してください` }, 400, ["name"]);
      }
    }
    let displayOrder: number | undefined;
    if (body.displayOrder !== undefined) {
      const order = Number(body.displayOrder);
      if (!Number.isInteger(order) || order < 0 || order > 10_000) {
        return inputError(c, { success: false, error: '並び順は0〜10000の整数で指定してください' }, 400, ["displayOrder"]);
      }
      displayOrder = order;
    }
    /*
     * R513: 読んだときの版を送り、変わっていたら409で止める。
     * 版が無い古い呼び出しは従来どおり上書きする（後方互換）。
     */
    let displayLocations;
    if (body.displayLocations !== undefined) {
      try { displayLocations = parseSupportMarkLocations(body.displayLocations); }
      catch { return inputError(c, {success:false,error:'表示する場所を選び直してください'},422,['displayLocations']); }
      if (!Number.isSafeInteger(body.expectedVersion)) return inputError(c,{success:false,error:'最新の版を指定してください'},422,['expectedVersion']);
    }
    let expectedVersion: number | undefined;
    if (body.expectedVersion !== undefined) {
      expectedVersion = Number(body.expectedVersion);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
        return inputError(c, { success: false, error: '最新の版を指定してください' }, 400, ["expectedVersion"]);
      }
    }
    // 既定を外す操作は止める。既定が1つも無いと、新しい友だちに何も付かない。
    // 別のマークを既定にすれば、こちらは自動で外れる。
    if (body.isDefault === false && existing.is_default === 1) {
      return c.json(
        {
          success: false,
          error:
            '既定のマークを外すことはできません。別のマークを既定にすると、こちらは自動で外れます。',
        },
        409,
      );
    }
    if (existing.is_inherited === 1) {
      const current = (await getSupportMarksWithUsage(c.env.DB, scope))
        .find((mark) => mark.id === id);
      if (!current || markReferenceCount(current) > 0) {
        return c.json(
          {
            success: false,
            error: '使用先がある共有マークは直接編集できません。使用先を別のマークへ変更してから編集してください。',
            code: 'INHERITED_MARK_IN_USE',
          },
          409,
        );
      }
    }
    const mark = await updateSupportMark(c.env.DB, id, scope, {
      name,
      color: body.color === undefined ? undefined : String(body.color),
      isDefault: body.isDefault === undefined ? undefined : body.isDefault === true,
      autoOnInbound: body.autoOnInbound === undefined ? undefined : body.autoOnInbound === true,
      displayOrder,
      displayLocations,
      actorId: c.get('staff').id,
      expectedVersion,
    });
    if (mark === 'conflict') {
      const latest = await getSupportMarkById(c.env.DB, id, scope);
      return c.json({
        success: false,
        error: 'ほかの担当者が先に変更しました。最新の内容を確認してから保存し直してください。',
        code: 'SUPPORT_MARK_VERSION_CONFLICT',
        data: latest ? { latest: serializeMark(latest) } : undefined,
      }, 409);
    }
    return c.json({ success: true, data: serializeMark(mark!) });
  } catch (err) {
    logger.error("routes_friend_attributes_failed");
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
};

export const get__api_support_marks_id_automation_rules_6 = async (c: Context<Env, "/api/support-marks/:id/automation-rules">) => {
    try {
      const scope = await supportMarkAccess(c);
      if (scope instanceof Response) return scope;
      const rules = await listSupportMarkAutomationRules(c.env.DB, scope, c.req.param('id'));
      if (!rules) return c.json({ success: false, error: '対応マークが見つかりません' }, 404);
      return c.json({ success: true, data: rules });
    } catch (err) {
      logger.error("routes_friend_attributes_failed");
      return c.json({ success: false, error: '自動変更ルールを読み込めませんでした' }, 500);
    }
  };

export const post__api_support_marks_id_automation_rules_7 = async (c: Context<Env, "/api/support-marks/:id/automation-rules">) => {
    try {
      const scope = await supportMarkAccess(c);
      if (scope instanceof Response) return scope;
      /*
       * D034: 応答だけ失った再試行で二重に作らないため、要求キーを必須にする。
       * 同じキー・同じ内容の再送は保存済みのルールを返し、同じキーに
       * 異なる内容が来たら作らず409で止める（マーク作成のR512と同じ約束）。
       */
      const idempotencyKey = c.req.header('Idempotency-Key')?.trim() ?? '';
      if (!idempotencyKey || idempotencyKey.length > 128) {
        return inputError(c, { success: false, error: 'Idempotency-Keyを指定してください' }, 400, []);
      }
      const input = supportMarkRuleInput(await c.req.json<Record<string, unknown>>());
      if (!input) return inputError(c, { success: false, error: '自動変更ルールの入力が正しくありません' }, 400, ["event","priority","manualProtectionMinutes","name","condition","isActive"]);
      const created = await createSupportMarkAutomationRuleIdempotent(
        c.env.DB, scope, c.req.param('id'), c.get('staff').id, input, idempotencyKey,
      );
      if (!created) return c.json({ success: false, error: '対応マークが見つかりません' }, 404);
      // 再送で保存済みを返したときは200、新しく作ったときは201。
      return c.json({ success: true, data: created.rule }, created.replayed ? 200 : 201);
    } catch (err) {
      if (err instanceof SupportMarkRuleCreateError) {
        return c.json({ success: false, code: err.code, error: err.message }, 409);
      }
      const reason = err instanceof Error ? err.message : '';
      if (reason.startsWith('rule_') || reason === 'manual_protection_invalid') {
        return inputError(c, { success: false, error: '自動変更ルールの入力が正しくありません' }, 422, ["event","priority","manualProtectionMinutes","name","condition","isActive"]);
      }
      logger.error("routes_friend_attributes_failed");
      return c.json({ success: false, error: '自動変更ルールを保存できませんでした' }, 500);
    }
  };

export const patch__api_support_mark_rules_ruleId_8 = async (c: Context<Env, "/api/support-mark-rules/:ruleId">) => {
    try {
      const scope = await supportMarkAccess(c);
      if (scope instanceof Response) return scope;
      const body = await c.req.json<Record<string, unknown>>();
      const input = supportMarkRuleInput(body);
      const expectedVersion = Number(body.expectedVersion);
      if (!input || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
        return inputError(c, { success: false, error: '最新の版を指定してください' }, 400, ["event","priority","manualProtectionMinutes","name","condition","isActive","expectedVersion"]);
      }
      const result = await updateSupportMarkAutomationRule(
        c.env.DB, scope, c.req.param('ruleId'), c.get('staff').id, expectedVersion, input,
      );
      if (result === 'not_found') return c.json({ success: false, error: '自動変更ルールが見つかりません' }, 404);
      if (result === 'conflict') return c.json({
        success: false,
        error: 'ほかの担当者が先に変更しました。最新の内容を読み直してください',
        code: 'SUPPORT_MARK_RULE_VERSION_CONFLICT',
      }, 409);
      return c.json({ success: true, data: result });
    } catch (err) {
      const reason = err instanceof Error ? err.message : '';
      if (reason.startsWith('rule_') || reason === 'manual_protection_invalid') {
        return inputError(c, { success: false, error: '自動変更ルールの入力が正しくありません' }, 422, ["event","priority","manualProtectionMinutes","name","condition","isActive"]);
      }
      logger.error("routes_friend_attributes_failed");
      return c.json({ success: false, error: '自動変更ルールを保存できませんでした' }, 500);
    }
  };

export const delete__api_support_mark_rules_ruleId_9 = async (c: Context<Env, "/api/support-mark-rules/:ruleId">) => {
    try {
      const scope = await supportMarkAccess(c);
      if (scope instanceof Response) return scope;
      let body: { expectedVersion?: unknown } = {};
      try {
        body = await c.req.json<{ expectedVersion?: unknown }>();
      } catch {
        // 本文なしは版未指定として、下の安定した400へ揃える。
      }
      const expectedVersion = Number(body.expectedVersion);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
        return c.json({ success: false, error: '最新の版を指定してください' }, 400);
      }
      const result = await archiveSupportMarkAutomationRule(
        c.env.DB, scope, c.req.param('ruleId'), expectedVersion,
      );
      if (result === 'not_found') return c.json({ success: false, error: '自動変更ルールが見つかりません' }, 404);
      if (result === 'conflict') return c.json({
        success: false,
        error: 'ほかの担当者が先に変更しました。最新の内容を読み直してください',
        code: 'SUPPORT_MARK_RULE_VERSION_CONFLICT',
      }, 409);
      return c.json({ success: true, data: null });
    } catch (err) {
      logger.error("routes_friend_attributes_failed");
      return c.json({ success: false, error: '自動変更ルールを停止できませんでした' }, 500);
    }
  };

export const get__api_support_marks_id_archive_impact_10 = async (c: Context<Env, "/api/support-marks/:id/archive-impact">) => {
    try {
      const scope = await supportMarkAccess(c);
      if (scope instanceof Response) return scope;
      const impact = await getSupportMarkArchiveImpact(c.env.DB, scope, c.req.param('id'));
      if (!impact) return c.json({ success: false, error: '対応マークが見つかりません' }, 404);
      const [rules, marks] = await Promise.all([
        listSupportMarkAutomationRules(c.env.DB, scope, impact.mark.id),
        getSupportMarksWithUsage(c.env.DB, scope),
      ]);
      return c.json({
        success: true,
        data: {
          mark: serializeMark(impact.mark, rules ?? []),
          ...serializeMarkImpact(impact.mark),
          automationRules: rules ?? [],
          displayTargets: parseSupportMarkLocations(JSON.parse(impact.mark.display_locations_json)).map(location=>location==='friends'?'friend_list':location),
          replacementOptions: marks
            .filter((mark) => mark.id !== impact.mark.id && mark.is_inherited !== 1)
            .map((mark) => serializeMark(mark)),
          canArchive: impact.canArchive,
          impactRevision: impact.revision,
          checkedAt: impact.checkedAt,
          expectedVersion: Number(impact.mark.version ?? 1),
        },
      });
    } catch (err) {
      logger.error("routes_friend_attributes_failed");
      return c.json({ success: false, error: '保管の影響を確認できませんでした' }, 500);
    }
  };

export const post__api_support_marks_id_archive_11 = async (c: Context<Env, "/api/support-marks/:id/archive">) => {
    try {
      const scope = await supportMarkAccess(c);
      if (scope instanceof Response) return scope;
      const idempotencyKey = c.req.header('Idempotency-Key')?.trim() ?? '';
      if (!idempotencyKey || idempotencyKey.length > 128) {
        return inputError(c, { success: false, error: 'Idempotency-Keyを指定してください' }, 400, []);
      }
      const body = await c.req.json<Record<string, unknown>>();
      const replacementRaw = typeof body.replacementMarkId === 'string'
        ? body.replacementMarkId.trim()
        : '';
      /*
       * R180: 使っている友だちが0人のときは置換先なしで保管できる。
       * 空の置換先はここでは null へ倒し、0人かどうかの判定は
       * `archiveSupportMarkWithReplacement` が最新の実値で行う。
       */
      const replacementMarkId = replacementRaw === '' ? null : replacementRaw;
      const impactRevision = typeof body.impactRevision === 'string'
        ? body.impactRevision.trim()
        : '';
      const expectedVersion = Number(body.expectedVersion);
      if (!impactRevision
        || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
        return inputError(c, { success: false, error: '確認版・現在版を指定してください' }, 400, ["impactRevision","expectedVersion"]);
      }
      const result = await archiveSupportMarkWithReplacement(c.env.DB, scope, {
        markId: c.req.param('id'),
        replacementMarkId,
        expectedVersion,
        impactRevision,
        idempotencyKey,
        actorId: c.get('staff').id,
      });
      const replacement = replacementMarkId === null
        ? null
        : await getSupportMarkById(c.env.DB, replacementMarkId, scope);
      return c.json({
        success: true,
        data: {
          ...result,
          replacementMark: replacement ? serializeMark(replacement) : null,
        },
      });
    } catch (err) {
      if (err instanceof SupportMarkArchiveError) {
        const status = err.code === 'not_found' ? 404 : 409;
        return inputError(c, { success: false, code: err.code, error: err.message }, status, []);
      }
      logger.error("routes_friend_attributes_failed");
      return c.json({ success: false, error: '対応マークを保管できませんでした' }, 500);
    }
  };

export const delete__api_support_marks_id_12 = async (c: Context<Env, "/api/support-marks/:id">) => {
  try {
    const scope = await supportMarkAccess(c);
    if (scope instanceof Response) return scope;
    const id = c.req.param('id');
    const existing = await getSupportMarkById(c.env.DB, id, scope);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    if (existing.is_inherited === 1) {
      return c.json(
        {
          success: false,
          error: '共通マークは削除できません。編集すると、このLINE公式アカウント専用になります。',
        },
        409,
      );
    }
    if (existing.is_default === 1) {
      return c.json(
        {
          success: false,
          error: '既定のマークは削除できません。先に別のマークを既定にしてください。',
        },
        409,
      );
    }
    const defaultMark = await getDefaultSupportMark(c.env.DB, scope);
    if (!defaultMark || defaultMark.id === id) {
      return c.json(
        {
          success: false,
          error: '置換先の初期値マークがありません。先に別のマークを初期値にしてください。',
        },
        409,
      );
    }

    const current = (await getSupportMarksWithUsage(c.env.DB, scope))
      .find((mark) => mark.id === id);
    if (!current) {
      return c.json(
        { success: false, error: '影響を確認できませんでした。状態を読み直してください。' },
        409,
      );
    }
    const impact = serializeMarkImpact(current);
    if (markReferenceCount(current) > 0) {
      return c.json(
        {
          success: false,
          error: 'このマークは配信などで使われています。先にすべての使用先から外してください。',
          code: 'REFERENCED',
          ...impact,
        },
        409,
      );
    }
    const body: Record<string, unknown> = await c.req
      .json<Record<string, unknown>>()
      .catch(() => ({}));
    const replacementMarkId = typeof body.replacementMarkId === 'string'
      ? body.replacementMarkId
      : '';
    if (replacementMarkId !== defaultMark.id) {
      return c.json(
        {
          success: false,
          error: `置換先を「${defaultMark.name}」にして、もう一度影響を確認してください。`,
          code: 'REPLACEMENT_REQUIRED',
          ...impact,
          replacementMark: serializeMark(defaultMark),
        },
        409,
      );
    }
    if (!sameMarkImpact(body.expectedImpact, impact)) {
      return c.json(
        {
          success: false,
          error: '確認後に使用状況が変わりました。最新の影響を確認してください。',
          code: 'IMPACT_CHANGED',
          ...impact,
          replacementMark: serializeMark(defaultMark),
        },
        409,
      );
    }
    const staff = c.get('staff');
    const replacedFriendCount = await replaceAndArchiveSupportMark(
      c.env.DB,
      id,
      defaultMark.id,
      scope,
      staff.id,
    );
    return c.json({
      success: true,
      data: {
        archived: true,
        replacedFriendCount,
        replacementMark: serializeMark(defaultMark),
      },
    });
  } catch (err) {
    logger.error("routes_friend_attributes_failed");
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
};

export const patch__api_friends_id_support_mark_13 = async (c: Context<Env, "/api/friends/:id/support-mark">) => {
    try {
      const scope = await supportMarkAccess(c);
      if (scope instanceof Response) return scope;
      const body = await c.req.json<{ markId?: unknown }>();
      const markId =
        body.markId === null || body.markId === '' || body.markId === undefined
          ? null
          : String(body.markId);
      if (markId) {
        const mark = await getSupportMarkById(c.env.DB, markId, scope);
        if (!mark) return inputError(c, { success: false, error: 'マークが見つかりません' }, 400, ["markId"]);
      }
      const updated = await setFriendSupportMark(
        c.env.DB,
        c.req.param('id'),
        markId,
        scope,
        c.get('staff').id,
      );
      if (!updated) return c.json({ success: false, error: '友だちが見つかりません' }, 404);
      return c.json({ success: true, data: null });
    } catch (err) {
      logger.error("routes_friend_attributes_failed");
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  };
