import { trackedLinkReferralMatchesAccount } from '../services/tracked-link-identity.js';
import { getCookie, deleteCookie } from 'hono/cookie';
import { verifyNavigationProof } from '../lib/navigation-proof.js';
import { failureMessage } from '../lib/failure-messages.js';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { accountCustomerStyle } from '../services/customer-style.js';
import { tracedFetch as fetch, logger } from '@line-crm/shared/server';
import { patchFriendMetadata } from '../features/friends/friend-metadata/index.js';
import { fail } from '../lib/fail.js';
import { accountCustomerLook } from '../services/customer-look.js';
import { customerLookPublicSettings, DEFAULT_CUSTOMER_LOOK } from '@line-crm/shared';
import { receiveEntryRouteCoupon } from '../services/entry-route-coupon.js';

import { getFriendByLineUserIdForAccount, createUser, getUserByEmailForAccess, linkFriendToUser, upsertFriend, getEntryRouteByRefCode, recordRefTracking, getLineAccountByChannelId, getLineAccountById, getLineAccounts, getTrackedLinkById, getMessageTemplateById, getScenarios, enrollFriendInScenario, getFriendAddScenarioIds, resolveLineCredential } from '@line-crm/db';
import { isStoppedEntryRouteRef, recordStopSuppressionSafe } from '../services/entry-route-stop.js';
import { buildIntroMessage } from '../services/intro-message.js';
import { introMessagePayload } from '../lib/intro-message-payload.js';
import { pushImmediateFirstStep } from '../services/immediate-first-step.js';
import { verifyCallerLineIdentity } from '../services/liff-auth.js';
import { safeRedirectTarget, storedRedirectTarget } from '../lib/safe-redirect.js';
import type { Env } from '../worker-env.js';
import { resolveLineToken } from '../services/line-token.js';
import { decodeState, errorPage, stoppedLineAccountResponse, saveFriendAddCandidate, linkIgIgsid, saveIgAccountMeta, applyRefAttribution, resolveXHarnessToken, applyXHarnessActions, completionPage } from './liff-definition.js';
import type { Context } from 'hono';

export const get__auth_callback_1 = async (c: Context<Env, "/auth/callback">) => {
  const code = c.req.query('code');
  const stateParam = c.req.query('state') || '';
  const error = c.req.query('error');


  let ref = '';
  let redirect = '';
  let redirectProof = '';
  let formId = '';
  let gateParam = '';
  let xhParam = '';
  let gclid = '';
  let fbclid = '';
  let twclid = '';
  let ttclid = '';
  let utmSource = '';
  let utmMedium = '';
  let utmCampaign = '';
  let accountParam = '';
  let igParam = '';
  let igaParam = '';
  let iganParam = '';
  try {
    const [payload, proof, extra] = stateParam.split('.');
    if (extra || !await verifyNavigationProof(c.env.LINE_CHANNEL_SECRET, 'liff-oauth', payload, proof || '')) return c.html(errorPage(failureMessage('Authorization failed')), 400);
    const envelope = JSON.parse(decodeState(payload));
    const nonce = getCookie(c, 'lh_liff_oauth');
    deleteCookie(c, 'lh_liff_oauth', { path: '/auth', secure: true, sameSite: 'Lax' });
    if (!nonce || nonce !== envelope.nonce || !Number.isFinite(envelope.expires) || envelope.expires <= Date.now() || envelope.expires > Date.now() + 10 * 60_000) return c.html(errorPage(failureMessage('Authorization failed')), 400);
    const parsed = JSON.parse(envelope.data);
    ref = parsed.ref || '';
    redirect = parsed.redirect || '';
    redirectProof = parsed.redirectProof || '';
    formId = parsed.form || '';
    gateParam = parsed.gate || '';
    xhParam = parsed.xh || '';
    gclid = parsed.gclid || '';
    fbclid = parsed.fbclid || '';
    twclid = parsed.twclid || '';
    ttclid = parsed.ttclid || '';
    utmSource = parsed.utmSource || '';
    utmMedium = parsed.utmMedium || '';
    utmCampaign = parsed.utmCampaign || '';
    accountParam = parsed.account || '';

    igParam = parsed.ig || '';
    igaParam = parsed.iga || '';
    iganParam = parsed.igan || '';
  } catch {
    return c.html(errorPage(failureMessage('Authorization failed')), 400);
  }

  if (error || !code) {
    return c.html(errorPage(failureMessage('Authorization failed')));
  }

  try {
    const baseUrl = new URL(c.req.url).origin;
    const callbackUrl = `${baseUrl}/auth/callback`;

    // 複数アカウントで送信元を誤らないよう、DB からログイン資格情報を解決する。
    let loginChannelId = c.env.LINE_LOGIN_CHANNEL_ID;
    let loginChannelSecret = c.env.LINE_LOGIN_CHANNEL_SECRET;
    let loginLineAccountId: string | null = null;
    if (accountParam) {
      const account = await getLineAccountByChannelId(c.env.DB, accountParam);
      const stopped = await stoppedLineAccountResponse(c, account?.id);
      if (stopped) return stopped;
      if (account?.login_channel_id && account?.login_channel_secret) {
        loginChannelId = account.login_channel_id;
        loginChannelSecret = account.login_channel_secret;
        loginLineAccountId = account.id;
      }
    }
    if (!loginLineAccountId) {
      loginLineAccountId = (await getLineAccounts(c.env.DB)).find(
        (account) => account.login_channel_id === loginChannelId,
      )?.id ?? null;
    }


    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUrl,
        client_id: loginChannelId,
        client_secret: loginChannelSecret,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      logger.error("liff.auth_callback_get_failed");
      return c.html(errorPage(failureMessage('Token exchange failed')));
    }

    const tokens = await tokenRes.json<{
      access_token: string;
      id_token: string;
      token_type: string;
    }>();

    // 環境の既定でなく、解決済みのログインチャネル ID で ID トークンを検証する。
    const verifyRes = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        id_token: tokens.id_token,
        client_id: loginChannelId,
      }),
    });

    if (!verifyRes.ok) {
      return c.html(errorPage(failureMessage('ID token verification failed')));
    }

    const verified = await verifyRes.json<{
      sub: string;
      name?: string;
      email?: string;
      picture?: string;
    }>();


    const profileRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    let displayName = verified.name || 'Unknown';
    let pictureUrl: string | null = null;
    if (profileRes.ok) {
      const profile = await profileRes.json<{
        userId: string;
        displayName: string;
        pictureUrl?: string;
      }>();
      displayName = profile.displayName;
      pictureUrl = profile.pictureUrl || null;
    }

    const db = c.env.DB;
    const lineUserId = verified.sub;

    // 再訪で通知しないよう、upsert より前に本当の新規友だちかを判定する。
    const preExistingFriend = await getFriendByLineUserIdForAccount(
      db,
      lineUserId,
      loginLineAccountId,
    );
    const isNewFriend = !preExistingFriend;

    // follow Webhook より先に到着した場合も、友だち行を作成・更新できるようにする。
    const friend = await upsertFriend(db, {
      lineUserId,
      lineAccountId: loginLineAccountId,
      displayName,
      pictureUrl,
      statusMessage: null,
    });

    // OAuth型の追加導線は /api/liff/link を通らないため、ここでも今回リンクを記録する。
    // 停止 ref の候補は save 側でも止めるが、ここで求めた判定を使い回す。
    const stoppedCallbackRef =
      ref && !ref.startsWith('xh:') ? await isStoppedEntryRouteRef(db, ref) : false;
    if (!stoppedCallbackRef) {
      await saveFriendAddCandidate(db, {
        lineAccountId: loginLineAccountId,
        friendId: friend.id,
        refCode: ref,
        source: 'line_login',
      });
    } else {
      // 停止試行を抑止台帳へ引き継ぎ、後の別followが
      // 自然流入扱いにならないようにする。保存・計測は抑止のまま。
      // 記録の恒久失敗は握り潰さない (fail-closed)。外側catchは200を返すため
      // ここで500にして、記録なしの完了扱いにしない。
      try {
        await recordStopSuppressionSafe(db, {
          lineAccountId: loginLineAccountId,
          lineUserId,
          friendId: friend.id,
          refCode: ref,
          source: 'line_login',
        });
      } catch (err) {
        logger.error("liff.auth_callback_get_failed");
        return c.html(errorPage(failureMessage('Internal error')), 500);
      }
    }

    // OAuth を通る新規・再訪と、LIFF だけの既存友だちが、同じ IG 連携を使う。
    const igLinkOk = await linkIgIgsid(c, friend.id, igParam);
    if (igLinkOk) await saveIgAccountMeta(db, friend.id, igaParam, iganParam);

    const identityAccount = loginLineAccountId ? await getLineAccountById(db, loginLineAccountId) : null;
    if (!identityAccount) return c.html(errorPage(failureMessage('Authorization failed')), 400);
    const identityTenant = identityAccount.tenant_id ?? DEFAULT_TENANT_ID;
    const identityAccounts = (await getLineAccounts(db)).filter(a => (a.tenant_id ?? DEFAULT_TENANT_ID) === identityTenant).map(a => a.id);

    let userId: string | null = null;


    const existingUserId = (friend as unknown as Record<string, unknown>).user_id as string | null;
    if (existingUserId) {
      userId = existingUserId;
    } else {
      // 別アカウントへの結び付けは、指定された既存 UUID を使う。



      if (!userId && verified.email) {
        const existingUser = await getUserByEmailForAccess(db, verified.email, { tenantId: identityTenant, allowedAccountIds: identityAccounts, includeUnlinked: true });
        if (existingUser) userId = existingUser.id;
      }

      // 既存の UUID が見つからない場合だけ本人を新規作成する。
      if (!userId) {
        const newUser = await createUser(db, {
          email: verified.email || null,
          tenantId: identityTenant,
          displayName,
        });
        userId = newUser.id;
      }


      await linkFriendToUser(db, friend.id, userId);
    }

    // xh: は一度限りの秘密なので ref_code に保存しない。入口表示後に停止された ref も、保存・計測・帰属をすべて止める。下流の抑止だけでは件数が増えるため、ここでも保存を拒む。未登録 ref は通常の共有名前空間として扱う。
    if (ref && !ref.startsWith('xh:') && !stoppedCallbackRef) {
      // 初回の流入元を後から変えられないよう、ref_code は未設定のときだけ保存する。
      await db
        .prepare(`UPDATE friends SET ref_code = ? WHERE id = ? AND ref_code IS NULL`)
        .bind(ref, friend.id)
        .run();


      const route = await getEntryRouteByRefCode(db, ref);

      // 広告へ帰属できるよう、クリック ID を流入記録に残す。
      await recordRefTracking(db, {
        refCode: ref,
        friendId: friend.id,
        entryRouteId: route?.id ?? null,
        sourceUrl: null,
        fbclid: fbclid || null,
        gclid: gclid || null,
        twclid: twclid || null,
        ttclid: ttclid || null,
        utmSource: utmSource || null,
        utmMedium: utmMedium || null,
        utmCampaign: utmCampaign || null,
        userAgent: c.req.header('User-Agent') || null,
        ipAddress: c.req.header('CF-Connecting-IP') || null,
      });

      await applyRefAttribution(c, ref, friend, lineUserId, {
        accountChannelId: accountParam || null,
        isNewFriend,
      });
    }

    // 広告 API の通知に使えるよう、クリック ID と UTM を友だちの metadata へ保存する。
    const adMeta: Record<string, string> = {};
    if (gclid) adMeta.gclid = gclid;
    if (fbclid) adMeta.fbclid = fbclid;
    if (twclid) adMeta.twclid = twclid;
    if (ttclid) adMeta.ttclid = ttclid;
    if (utmSource) adMeta.utm_source = utmSource;
    if (utmMedium) adMeta.utm_medium = utmMedium;
    if (utmCampaign) adMeta.utm_campaign = utmCampaign;

    // 停止由来では広告ID・UTMを friends metadata へ新規保存しない。
    if (!stoppedCallbackRef && Object.keys(adMeta).length > 0) {
      await patchFriendMetadata(db, friend.id, adMeta);
    }

    // xh: のトークンから X と LINE の結び付けを解決する。
    if (ref && ref.startsWith('xh:')) {
      try {
        const xhToken = ref.slice(3);
        const xhResult = await resolveXHarnessToken(xhToken, c.env);
        if (xhResult?.xUsername) {
          await patchFriendMetadata(db, friend.id, { x_username: xhResult.xUsername });
          logger.log("routes_liff_log");
        }

        if (xhResult) {
          await applyXHarnessActions(db, friend.id, xhResult);
        }
      } catch (err) {
        logger.error("liff.auth_callback_get_failed");
      }
    }

    // 経路がアカウントの友だち追加シナリオを明示的に除外した場合は、自動登録と即時配信を行わない。
    const referralRouteForOverride =
      ref && !ref.startsWith('xh:') ? await getEntryRouteByRefCode(db, ref) : null;
    // 停止ref由来では unknown-route/アカウント共通の友だち追加
    // シナリオを含めタグ・シナリオを一切開始しない。停止refを消した後は
    // referralRouteForOverride が null になるため、従来の条件だけでは
    // アカウント共通シナリオへ流れてしまう。ref 無しの自然流入は通す。
    const runAccountScenariosLiff =
      !stoppedCallbackRef &&
      (!referralRouteForOverride || referralRouteForOverride.run_account_friend_add_scenarios !== 0);

    try {
      // 送信元を誤らないよう、友だちの所属を解決する。
      const matchedAccountId = accountParam
        ? (await getLineAccountByChannelId(db, accountParam))?.id ?? null
        : null;

      const scenarios = runAccountScenariosLiff ? await getScenarios(db) : [];
      // きっかけは scenario_triggers から引く（webhook と同じ扱い）。
      const liffFriendAddIds =
        scenarios.length > 0 ? new Set(await getFriendAddScenarioIds(db)) : new Set<string>();
      for (const scenario of scenarios) {
        const scenarioAccountMatch = !scenario.line_account_id || !matchedAccountId || scenario.line_account_id === matchedAccountId;
        if (!liffFriendAddIds.has(scenario.id) || !scenarioAccountMatch) {
          continue;
        }
        // 1つの登録・送信の失敗で残りを欠落させないよう、シナリオごとに例外を分ける。
        try {
          // OAuth の再ログインで完了済み購読を作り直さないよう、登録履歴のない友だちだけを追加する。実際の再追加は follow Webhook が扱う。follow 前・移行済みなどの友だちには、この経路が必要なので新規行だけに限定しない。
          const priorEnrollment = await db
            .prepare(`SELECT id FROM friend_scenarios WHERE friend_id = ? AND scenario_id = ?`)
            .bind(friend.id, scenario.id)
            .first();
          if (priorEnrollment) continue;
          const enrollment = await enrollFriendInScenario(db, friend.id, scenario.id);
          if (enrollment) {
            // once の共通サービスで実行権取得と通番更新を行い、cron が初回文を再送しないようにする。宛先は検証済み id_token を使う。
            await pushImmediateFirstStep(
              db,
              friend.id,
              scenario.id,
              {
                defaultAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
                workerUrl: c.env.WORKER_URL,
                accountChannelId: accountParam || null,
              },
              { enrollment, targetLineUserId: lineUserId },
            );
          }
        } catch (err) {
          logger.error("liff.auth_callback_get_failed");
        }
      }
    } catch (err) {
      logger.error("liff.auth_callback_get_failed");
    }

    // javascript:/data:/別ホスト形式の相対 URL による不正移動を防ぎ、許可する移動先だけへ案内する。
    const safeRedirect = safeRedirectTarget(redirect, new URL(c.req.url).origin)
      || (await verifyNavigationProof(c.env.LINE_CHANNEL_SECRET, `redirect:${identityAccount.liff_id ?? ''}`, redirect, redirectProof) ? storedRedirectTarget(redirect) : null);
    if (safeRedirect) {
      return c.redirect(safeRedirect);
    }


    if (formId && friend?.line_user_id) {
      try {
        // フォームの使い回しでも正しい条件を使うよう、所属 LIFF と gate/xh を引き継ぐ。秘密の xh: トークンと停止 ref を外部 URL や QR に載せず、停止した帰属を復活させない。
        const formAccountId = loginLineAccountId ?? friend.line_account_id ?? null;
        const refLink = ref && !stoppedCallbackRef ? await getTrackedLinkById(db, ref) : null;
        const trackedLink = refLink && await trackedLinkReferralMatchesAccount(db, refLink, formAccountId)
          ? refLink : null;
        const externalRefForForm = ref && !ref.startsWith('xh:') && !stoppedCallbackRef
          && (!refLink || trackedLink) ? ref : '';
        const formQuery = new URLSearchParams();
        formQuery.set('page', 'form');
        formQuery.set('id', formId);
        if (externalRefForForm) formQuery.set('ref', externalRefForForm);
        if (gateParam) formQuery.set('gate', gateParam);
        if (xhParam) formQuery.set('xh', xhParam);
        let formLiffUrl = `${new URL(c.req.url).origin}?${formQuery.toString()}`;
        const { LineClient } = await import('@line-crm/line-sdk');
        const { getLineAccountById: getAcctById } = await import('@line-crm/db');
        let accountToken: string | null = null;
        if (formAccountId) {
          const account = await getAcctById(db, formAccountId);
          accountToken = account?.channel_access_token ?? null;
          if (account?.liff_id) {
            formLiffUrl = `https://liff.line.me/${account.liff_id}?${formQuery.toString()}`;
          }
        }
        const accessToken = resolveLineToken({
          accountToken,
          defaultToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
          accountId: formAccountId,
          context: 'liff.oauth-form-send',
        });
        if (formLiffUrl.startsWith(`${new URL(c.req.url).origin}`)) {
          const envLiffUrl = c.env.LIFF_URL || '';
          const envLiffIdMatch = envLiffUrl.match(/liff\.line\.me\/([0-9]+-[A-Za-z0-9]+)/);
          if (envLiffIdMatch) {
            formLiffUrl = `https://liff.line.me/${envLiffIdMatch[1]}?${formQuery.toString()}`;
          }
        }
        // クライアントの ref だけで報酬を変えられないよう、計測リンクの初回値を未設定時だけ固定し、回答処理はそれを正本にする。
        let introTemplate = null;
        // 停止 entry route の ref は tracked fallback へ落とさない。
        if (trackedLink) {
          try {
            const { setFriendFirstTrackedLinkIfNull } = await import('@line-crm/db');
            await setFriendFirstTrackedLinkIfNull(db, friend.id, trackedLink.id);
          } catch (e) {
            logger.error("liff.auth_callback_get_failed");
          }
          if (trackedLink.intro_template_id) {
            introTemplate = await getMessageTemplateById(db, trackedLink.intro_template_id);
          }
        }
        // intro テンプレートの {{var.*}} は送信時点の値へ置き換える。
        // 消えた共通情報があれば fail-closed で止める（この catch 節へ落ちる）。
        if (introTemplate) {
          const { expandSendCommonVars } = await import('../services/interpolation-context.js');
          introTemplate = {
            ...introTemplate,
            message_content: await expandSendCommonVars(
              db, introTemplate.message_content,
              { kind: 'liff', id: introTemplate.id },
              { lineAccountId: formAccountId, friendId: friend.id, messageType: introTemplate.message_type },
            ),
          };
        }
        const introMessage = buildIntroMessage(introTemplate, formLiffUrl);

        const lineClient = new LineClient(accessToken);
        await lineClient.pushMessage(friend.line_user_id, [introMessagePayload(introMessage)]);
      } catch (err) {
        logger.error("liff.auth_callback_get_failed");
      }
    }

    // 正しい Bot のトークへ戻すため、指定アカウント・友だちの所属・認証に使ったログインチャネルの順で解決する。
    let redirectAccount: Record<string, string> | null = null;
    if (accountParam) {
      redirectAccount = await getLineAccountByChannelId(db, accountParam) as Record<string, string> | null;
    }
    if (!redirectAccount) {
      // 今回の OAuth のログインチャネルからアカウントを探す。
      redirectAccount = await db
        .prepare('SELECT * FROM line_accounts WHERE login_channel_id = ?')
        .bind(loginChannelId)
        .first<Record<string, string>>();
    }
    if (!redirectAccount) {
      // 見つからなければ稼働中の先頭アカウントを使う。
      redirectAccount = await db
        .prepare('SELECT * FROM line_accounts WHERE is_active = 1 LIMIT 1')
        .first<Record<string, string>>();
    }
    if (redirectAccount?.channel_access_token) {
      try {
        const botInfo = await fetch('https://api.line.me/v2/bot/info', {
          headers: { Authorization: `Bearer ${redirectAccount.channel_access_token}` },
        });
        if (botInfo.ok) {
          const bot = await botInfo.json() as { basicId?: string };
          if (bot.basicId) {
            return c.redirect(`https://line.me/R/ti/p/${bot.basicId}`);
          }
        }
      } catch {
        // Fall through to completion page
      }
    }

    return c.html(completionPage(displayName, pictureUrl, ref));

  } catch (err) {
    logger.error("liff.auth_callback_get_failed");
    return c.html(errorPage(failureMessage('Internal error')));
  }
};

export const get__api_liff_customer_look_2 = async (c: Context<Env, "/api/liff/customer-look">) => {
 const liffId=c.req.query('liffId');if(!liffId)return c.json({success:false,error:'liffId is required'},400);
 const account=await c.env.DB.prepare('SELECT id FROM line_accounts WHERE liff_id = ? AND is_active = 1').bind(liffId).first<{id:string}>();
 if(!account)return c.json({success:false,error:'unknown_liff'},404);
 const stopped=await stoppedLineAccountResponse(c,account.id);if(stopped)return stopped;
 const value=await accountCustomerLook(c.env.DB,account.id);
 c.header('Cache-Control','no-store');
 return c.json({success:true,data:{...value,settings:customerLookPublicSettings(value.look),style:await accountCustomerStyle(c.env.DB,account.id)}});
};

export const get__api_liff_config_3 = async (c: Context<Env, "/api/liff/config">) => {
  try {
    const liffId = c.req.query('liffId');
    if (!liffId) {
      return c.json({ success: false, error: 'liffId is required' }, 400);
    }

    const account = await c.env.DB
      .prepare('SELECT id, name, channel_access_token, channel_access_token_encrypted FROM line_accounts WHERE liff_id = ? AND is_active = 1')
      .bind(liffId)
      .first<{ id: string; name: string; channel_access_token: string; channel_access_token_encrypted: string | null }>();

    const stopped = await stoppedLineAccountResponse(c, account?.id);
    if (stopped) return stopped;

    // DB に LIFF ID がなければ、環境の既定アカウントを使う。
    const accessToken = account
      ? await resolveLineCredential(
          account.channel_access_token_encrypted,
          account.channel_access_token,
          { lineAccountId: account.id, field: 'channel_access_token' },
        )
      : c.env.LINE_CHANNEL_ACCESS_TOKEN;
    const accountName = account?.name || 'Default';
    const accountId = account?.id || 'default';


    let botBasicId = '';
    try {
      const botRes = await fetch('https://api.line.me/v2/bot/info', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (botRes.ok) {
        const bot = await botRes.json() as { basicId?: string };
        botBasicId = bot.basicId || '';
      }
    } catch {
      // non-blocking
    }

    c.header('Cache-Control', 'no-store');
    return c.json({
      success: true,
      data: {
        style: account ? await accountCustomerStyle(c.env.DB, account.id) : null,
        botBasicId,
        accountName,
        accountId,
        redirectTarget: await verifyNavigationProof(c.env.LINE_CHANNEL_SECRET, `redirect:${liffId}`, c.req.query('redirect') || '', c.req.query('redirectProof') || '') ? storedRedirectTarget(c.req.query('redirect')) : null,
        customerLook: account ? (await accountCustomerLook(c.env.DB, account.id)).look : DEFAULT_CUSTOMER_LOOK,
      },
    });
  } catch (err) {
    throw err;
  }
};

export const post__api_liff_profile_4 = async (c: Context<Env, "/api/liff/profile">) => {
  try {
    const identity = await verifyCallerLineIdentity(c.req.header('Authorization'), c.env);
    if (!identity) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    const stopped = await stoppedLineAccountResponse(c, identity.lineAccountId);
    if (stopped) return stopped;

    const friend = await getFriendByLineUserIdForAccount(
      c.env.DB,
      identity.lineUserId,
      identity.lineAccountId,
    );
    if (!friend) {
      return fail(c, 404, 'FRIEND_NOT_FOUND');
    }

    c.header('Cache-Control', 'no-store');
    return c.json({
      success: true,
      data: {
        style: identity.lineAccountId ? await accountCustomerStyle(c.env.DB, identity.lineAccountId) : null,
        id: friend.id,
        displayName: friend.display_name,
        isFollowing: Boolean(friend.is_following),
        userId: (friend as unknown as Record<string, unknown>).user_id ?? null,
      },
    });
  } catch (err) {
    throw err;
  }
};

export const post__api_liff_entry_route_coupon_5 = async (c: Context<Env, "/api/liff/entry-route-coupon">) => {
  try {
    const identity = await verifyCallerLineIdentity(c.req.header('Authorization'), c.env);
    if (!identity) return c.json({ success: false, error: 'Invalid ID token' }, 401);
    const stopped = await stoppedLineAccountResponse(c, identity.lineAccountId);
    if (stopped) return stopped;
    const body = await c.req.json<{ ref?: unknown }>();
    if (typeof body.ref !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(body.ref)) {
      return c.json({ success: false, error: 'ref が正しくありません' }, 400);
    }
    const route = await getEntryRouteByRefCode(c.env.DB, body.ref);
    if (!identity.lineAccountId || !route || route.line_account_id !== identity.lineAccountId) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const friend = await getFriendByLineUserIdForAccount(c.env.DB, identity.lineUserId, identity.lineAccountId);
    if (!friend || friend.is_following !== 1) return c.json({ success: false, error: '友だち追加が必要です' }, 409);
    const coupon = await receiveEntryRouteCoupon(c.env.DB, route, friend);
    if (!coupon) return c.json({ success: false, error: 'このクーポンは現在受け取れません', code: 'ENTRY_COUPON_UNAVAILABLE' }, 409);
    return c.json({ success: true, data: coupon });
  } catch (error) {
    throw error;
  }
};
