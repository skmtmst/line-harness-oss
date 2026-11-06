import { describe, expect, it } from 'vitest';
import { legacyApiErrorBody, readApiError } from './api-errors.js';

describe('API失敗の読み取り', () => {
  it('欄ごとの理由・機械コード・追跡番号を旧応答と共通応答から読む', () => {
    const detail = { code: 'VERSION_CONFLICT', message: '最新の内容を確認してください。', requestId: 'request-1',
      fieldErrors: [{ field: 'name', message: '名前を確認してください。' }] };
    const expected = { code: detail.code, message: detail.message, requestId: detail.requestId, fields: { name: '名前を確認してください。' } };
    expect(readApiError({ success: false, error: detail })).toEqual(expected);
    expect(readApiError({ error: detail.message, code: detail.code, incidentId: detail.requestId, fields: expected.fields })).toEqual(expected);
  });
  it('非JSON相当と不正な欄の型を表示用データにしない', () => {
    expect(readApiError(null)).toEqual({ fields: {} });
    expect(readApiError({ error: { code: '<script>', fieldErrors: [{ field: 'title', message: 1 }] } })).toEqual({ fields: {} });
  });
  it('LIFFの既存のコード分岐と、画面更新に必要な追加データを保つ', () => {
    expect(legacyApiErrorBody({ data: { version: 2 }, error: { code: 'slot_full', message: '満席です。', requestId: 'r', fieldErrors: [] } }))
      .toEqual({ data: { version: 2 }, error: 'slot_full', code: 'slot_full', message: '満席です。', requestId: 'r', fields: {} });
  });
  it('入力欄の鍵でprototypeを変更しない', () => {
    const parsed = readApiError(JSON.parse('{"fields":{"__proto__":"形式を確認してください"}}'));
    expect(Object.getPrototypeOf(parsed.fields)).toBe(Object.prototype);
    expect(Object.keys(parsed.fields)).toEqual(['__proto__']);
  });
});
