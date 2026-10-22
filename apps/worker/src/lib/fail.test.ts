import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { fail } from './fail.js';
import { inputError, inputJsonBoundary } from './input-errors.js';
import { apiContractMiddleware, normalizeApiFailure } from '../middleware/api-contract.js';
import { FAILURE_MESSAGES, failureMessage } from './failure-messages.js';

const requestId = 'ab9daa00-9761-40a9-a9ee-a2c21bbe62c0';

describe('使う人への失敗の理由', () => {
  it.each([
    ['accountId is required', 400, 'ACCOUNT_ID_REQUIRED', 'LINE公式アカウントを選んでください。'],
    ['accountId query param required', 400, 'ACCOUNT_ID_REQUIRED', 'LINE公式アカウントを選んでください。'],
    ['Friend not found', 404, 'FRIEND_NOT_FOUND', '友だちが見つかりません。一覧から開き直してください。'],
    ['LINE account not found', 404, 'LINE_ACCOUNT_NOT_FOUND', 'LINE公式アカウントが見つかりません。一覧から開き直してください。'],
    ['name must be 60 characters or fewer', 400, 'NAME_MUST_BE_60_CHARACTERS_OR_FEWER', '名前は60文字以下にしてください。'],
    ['expectedVersion is required', 400, 'EXPECTED_VERSION_IS_REQUIRED', '操作に必要な最新の状態を確認できません。画面を読み直してください。'],
    ['idToken is required', 400, 'ID_TOKEN_IS_REQUIRED', 'LINEでログインし直してから、もう一度操作してください。'],
    ['Identity required', 401, 'IDENTITY_REQUIRED', '本人確認の情報がありません。LINEでログインし直してください。'],
    ['Account unavailable', 503, 'ACCOUNT_UNAVAILABLE', 'このLINE公式アカウントは現在利用できません。管理者にお問い合わせください。'],
    ['Identity unavailable', 401, 'IDENTITY_UNAVAILABLE', '本人確認を利用できません。LINEログインの設定を管理者に確認してください。'],
    ['Internal server error', 500, 'INTERNAL_SERVER_ERROR', '処理を完了できませんでした。状態を確認し、管理者にお問い合わせください。'],
  ] as const)('%s の理由がHTTPの応答に届く', async (reason, status, code, message) => {
    const api = new Hono().use('*', apiContractMiddleware);
    api.get('/api/failure', c => c.json({ success: false, error: reason }, status));
    const response = await api.request('/api/failure');
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ success: false, error: {
      code, message, requestId: response.headers.get('X-Request-ID'), fieldErrors: [],
    } });
  });

  it('既存コード・項目別の理由・入力済みの欄・復旧情報を保つ', async () => {
    const api = new Hono().use('*', apiContractMiddleware);
    api.post('/api/input', inputJsonBoundary(), c => inputError(c, {
      success: false, error: 'name and triggerType are required', code: 'existing_lowercase_code',
      data: { canRetry: false, currentVersion: 3 },
    }, 400, ['name', 'triggerType']));
    const response = await api.request('/api/input', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '入力済み' }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, data: { canRetry: false, currentVersion: 3 },
      error: { code: 'existing_lowercase_code', message: '名前と開始のきっかけを指定してください。',
        fieldErrors: [{ field: 'triggerType', message: '名前と開始のきっかけを指定してください。' }] } });
  });

  it('欄ごとに異なる英語の理由も、それぞれ日本語にする', () => {
    expect(normalizeApiFailure({ error: 'Invalid payload', fields: {
      name: 'name is required', accountId: 'accountId is required',
    } }, 422, requestId).error.fieldErrors).toEqual([
      { field: 'name', message: '名前を入力してください。' },
      { field: 'accountId', message: 'LINE公式アカウントを選んでください。' },
    ]);
  });

  it.each([
    ['Authorization failed', 400, 'AUTHORIZATION_FAILED', '本人確認に失敗しました。お手数ですが、リンクを開き直してください。'],
    ['Token exchange failed', 400, 'TOKEN_EXCHANGE_FAILED', 'LINEとの連携を完了できませんでした。時間をおいて、リンクを開き直してください。'],
    ['ID token verification failed', 401, 'ID_TOKEN_VERIFICATION_FAILED', '本人確認の情報を確認できませんでした。お手数ですが、リンクを開き直してください。'],
    ['Internal error', 500, 'INTERNAL_ERROR', '処理を完了できませんでした。時間をおいて、もう一度お試しください。'],
    ['Invalid liffId', 400, 'INVALID_LIFF_ID', 'お客さま用画面の指定を確認できません。リンクを開き直してください。'],
  ] as const)('お客さまの画面に出る英語の理由 %s も日本語にする', (reason, status, code, message) => {
    const result = normalizeApiFailure({ error: reason }, status, requestId);
    expect(result.error).toMatchObject({ code, message });
    expect(result.error.message).toMatch(/[ぁ-んァ-ヶ一-龠]/u);
    expect(failureMessage(reason)).toBe(message);
  });

  it('対応表にない理由の代わりも日本語で返す', () => {
    expect(failureMessage('Something unexpected happened')).toMatch(/[ぁ-んァ-ヶ一-龠]/u);
  });

  it('共通failも既存コード・フィールド・データ・待機の見出しを保持する', async () => {
    const api = new Hono().use('*', apiContractMiddleware);
    api.post('/api/input', c => fail(c, 422, 'INVALID_SETTINGS', {
      error: '設定内容を選び直してください。', data: { currentVersion: 4 },
    }, ['settings']));
    api.post('/api/unknown', c => {
      c.header('Retry-After', '60');
      return fail(c, 409, 'delivery_unknown', { data: { canRetry: false }, currentVersion: 4 });
    });
    const input = await api.request('/api/input', { method: 'POST' });
    expect(await input.json()).toMatchObject({ data: { currentVersion: 4 }, error: { code: 'INVALID_SETTINGS',
      message: '設定内容を選び直してください。', fieldErrors: [{ field: 'settings', message: '設定内容を選び直してください。' }] } });
    const unknown = await api.request('/api/unknown', { method: 'POST' });
    expect(unknown.status).toBe(409);
    expect(unknown.headers.get('Retry-After')).toBe('60');
    expect(await unknown.json()).toMatchObject({ data: { canRetry: false }, currentVersion: 4,
      error: { code: 'delivery_unknown' } });
  });

  it('共通failは固定コードだけでも理由を返し、入力済みの欄を赤くしない', async () => {
    const api = new Hono().use('*', apiContractMiddleware);
    api.post('/api/account', c => fail(c, 400, 'ACCOUNT_ID_REQUIRED'));
    api.post('/api/input', inputJsonBoundary(), c => fail(c, 400, 'name and triggerType are required', {}, ['name', 'triggerType']));
    expect(await (await api.request('/api/account', { method: 'POST' })).json()).toMatchObject({ error: {
      code: 'ACCOUNT_ID_REQUIRED', message: 'LINE公式アカウントを選んでください。',
    } });
    const response = await api.request('/api/input', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '入力済み' }) });
    expect(await response.json()).toMatchObject({ error: {
      message: '名前と開始のきっかけを指定してください。',
      fieldErrors: [{ field: 'triggerType', message: '名前と開始のきっかけを指定してください。' }],
    } });
  });

  it('動的な理由の識別番号や外部本文を案内へ埋め込まない', () => {
    const cases = [
      ['Platform "customer@example.invalid" not found', 'PLATFORM_NOT_FOUND'],
      ['loginChannelId \'private-channel\' is already assigned to another account', 'LOGIN_CHANNEL_IN_USE'],
      ['Unsupported broadcast variables: {{private-name}}', 'UNSUPPORTED_BROADCAST_VARIABLES'],
      ['Failed to link rich menu to friend: Bearer private-token', 'RICH_MENU_LINK_FAILED'],
    ];
    for (const [reason, code] of cases) {
      const result = normalizeApiFailure({ error: reason }, 400, requestId);
      expect(result.error.code).toBe(code);
      expect(result.error.message).toMatch(/[ぁ-んァ-ヶ一-龠]/u);
      expect(result.error.message).not.toMatch(/private|customer|Bearer/);
    }
  });

  it('日本語の案内へ混ざった画像検証の英語も、本文と欄の両方で言い換える', () => {
    const reason = '選ばれた画像を使えません: file size 2000000 exceeds 1MB limit';
    expect(normalizeApiFailure({ error: reason, fields: { imageR2Key: reason } }, 400, requestId).error)
      .toMatchObject({ code: 'RICH_MENU_IMAGE_TOO_LARGE', message: '画像は1MB以下にしてください。',
        fieldErrors: [{ field: 'imageR2Key', message: '画像は1MB以下にしてください。' }] });
  });

  it.each(['toString', '__proto__', 'SELECT secret FROM friends', 'Error: SQL failed',
    '入力失敗 https://private.invalid', '入力失敗 Bearer private-token', '入力失敗 customer@example.invalid'])
  ('自由な失敗の本文と内部情報を出さない: %s', reason => {
    const result = normalizeApiFailure({ error: reason }, 500, requestId);
    expect(result.error.message).toBe('処理を完了できませんでした。状態を確認し、管理者にお問い合わせください。');
    expect(result.error.requestId).toBe(requestId);
  });

  it('固定の案内は画面の安全な長さと日本語の条件を満たす', () => {
    for (const [code, message] of Object.values(FAILURE_MESSAGES)) {
      expect(code).toMatch(/^[A-Za-z][A-Za-z0-9_]{0,63}$/);
      expect(message).toMatch(/[ぁ-んァ-ヶ一-龠]/u);
      expect(message.length).toBeLessThanOrEqual(240);
      expect(message).not.toMatch(/https?:\/\/|D1_ERROR|node_modules|Bearer\s|@/i);
    }
  });
});
