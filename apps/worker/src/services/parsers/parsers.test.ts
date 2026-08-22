import { describe, expect, it } from 'vitest';
import { parserFor } from './index.js';

const DATE_HEADER = 'Sat, 22 Aug 2026 12:00:00 +0900';

function parse(key: string, subject: string, body: string) {
  const parser = parserFor(key);
  if (!parser) throw new Error(`missing parser: ${key}`);
  return parser.parse({ subject, body, dateHeader: DATE_HEADER });
}

const RETTY_DETAILS = [
  '予約番号： RT-100',
  '予約者氏名： テスト 太郎',
  '電話番号　： 090-0000-0000',
  'ご来店日： 2026年8月30日',
  'ご来店時間： 18:30',
  'ご予約人数：2名',
  'コース： テストコース',
  '席種： テーブル',
].join('\r\n');

describe('媒体別予約メールパーサー', () => {
  it('Rettyの新規・リクエスト・キャンセル・日次を順序どおり判定する', () => {
    expect(parse('retty', '新規予約', RETTY_DETAILS).kind).toBe('confirmed');
    expect(parse('retty', 'リクエスト予約', `${RETTY_DETAILS}\nリクエスト予約の承認ページ`).kind).toBe('request');
    expect(parse('retty', 'キャンセル', `${RETTY_DETAILS}\nキャンセル理由：予約変更`).kind).toBe('cancelled');
    expect(parse('retty', '【予約件数 1件】', '2026年8月30日\n【予約1】テスト 太郎').kind).toBe('digest');
  });

  it.each([
    ['未確定', 'request'],
    ['確定済', 'confirmed'],
    ['キャンセル', 'cancelled'],
  ] as const)('ぐるなびは件名ではなく状態「%s」で%sになる', (state, expected) => {
    const result = parse('gurunavi', '件名に確定と書かれていても状態を優先', [
      'テスト店舗 様 (gjge300)',
      '［予約番号］ GN-100',
      `［状態］ ${state}`,
      '［来店日時］ 2026年08月30日(日) 18時30分',
      '［来店人数］ 2名',
      '［テーブル］ T-1',
      '［予約者名］ テスト 太郎様',
      '［電話番号］ 090-0000-0000',
      '［コース］',
      'テストコース',
    ].join('\n'));
    expect(result).toMatchObject({ kind: expected, mediaStoreCode: 'gjge300' });
  });

  it('ぐるなびの未知状態はunknownになる', () => {
    expect(parse('gurunavi', '予約', '［状態］ お断り').kind).toBe('unknown');
  });

  it('食べログはURLから予約番号と年を取得する', () => {
    const result = parse('tabelog', '【新規予約】テスト', [
      'お名前 ： テスト 太郎',
      '電話番号 ： 090-0000-0000',
      '日付 ： 08/30',
      '来店時刻 ： 18:30',
      '滞在可能時間 ： 2時間',
      '人数 ： 2名',
      'コース ： テストコース',
      '卓 ： T-1',
      'https://owner.tabelog.com/tn/time-schedule/2026-08-30?bookingId=net:19693630',
    ].join('\n'));
    expect(result).toMatchObject({
      kind: 'confirmed', externalId: 'net:19693630',
      startsAt: '2026-08-30T18:30:00+09:00', stayMinutes: 120,
    });
  });

  it('食べログの本文月日とURL月日が不一致なら未処理理由を返す', () => {
    const result = parse('tabelog', '【新規予約】テスト', [
      '日付 ： 08/31',
      '来店時刻 ： 18:30',
      '人数 ： 2名',
      'https://owner.tabelog.com/tn/time-schedule/2026-08-30?bookingId=net:19693630',
    ].join('\n'));
    expect(result.validationError).toBe('tabelog_date_mismatch');
  });

  it('ホットペッパー変更は変更後だけを採用する', () => {
    const result = parse('hotpepper', '予約内容の変更処理完了', [
      '■予約依頼番号： HP-100',
      '■代表者： テスト 太郎様',
      '【変更前】',
      '■来店日時：2026年8月29日(土) 17:00',
      '■人数：1名様',
      '■ステータス：未対応',
      '【変更後】',
      '■来店日時：2026年8月30日(日) 19:00',
      '■コース：変更後コース',
      '■席情報：テーブルA',
      '■人数：3名様',
      '■ステータス：相談中',
    ].join('\n'));
    expect(result).toMatchObject({
      kind: 'request', startsAt: '2026-08-30T19:00:00+09:00', guestCount: 3,
      courseName: '変更後コース',
    });
    expect(result.startsAt).not.toContain('2026-08-29');
  });

  it('ホットペッパーは本文だけに変更処理完了がある場合も変更後を採用する', () => {
    const result = parse('hotpepper', 'ご予約内容のお知らせ', [
      '変更処理完了',
      '■予約依頼番号： HP-104',
      '■代表者： テスト 太郎様',
      '【変更前】',
      '■来店日時：2026年8月29日(土) 17:00',
      '■人数：1名様',
      '■ステータス：未対応',
      '【変更後】',
      '■来店日時：2026年8月30日(日) 20:00',
      '■コース：本文判定コース',
      '■人数：4名様',
      '■ステータス：相談中',
    ].join('\n'));
    expect(result).toMatchObject({
      kind: 'request', startsAt: '2026-08-30T20:00:00+09:00', guestCount: 4,
      courseName: '本文判定コース',
    });
    expect(result.startsAt).not.toContain('2026-08-29');
  });

  it('ホットペッパー変更後のキャンセル理由を残す', () => {
    const result = parse('hotpepper', '予約内容の変更処理完了', [
      '■予約依頼番号： HP-101',
      '■代表者： テスト 太郎様',
      '【変更前】',
      '■ステータス：未対応',
      '【変更後】',
      '■来店日時：2026年8月30日(日) 19:00',
      '■人数：2名様',
      '■ステータス：キャンセル（予約変更）',
    ].join('\n'));
    expect(result).toMatchObject({ kind: 'cancelled', cancelReason: 'キャンセル（予約変更）' });
  });

  it('ホットペッパー変更後の未知ステータスはunknownになる', () => {
    const result = parse('hotpepper', '予約内容の変更処理完了', [
      '【変更後】', '■ステータス：確認保留',
    ].join('\n'));
    expect(result.kind).toBe('unknown');
  });

  it('ホットペッパーは電話番号なしでも項目を抽出できる', () => {
    const result = parse('hotpepper', '【即予約】テストの申し込み', [
      '■予約依頼番号： HP-102',
      '■来店日時：2026年8月30日(日) 18:30',
      '■代表者：テスト 太郎様',
      '■コース：テスト',
      '■席情報：テーブル',
      '■人数：2名様',
    ].join('\n'));
    expect(result).toMatchObject({ kind: 'confirmed', externalId: 'HP-102', guestCount: 2 });
    expect(result.customerPhone).toBeUndefined();
  });

  it('ホットペッパーの複数行席情報を次の■まで取得する', () => {
    const result = parse('hotpepper', '【即予約】テストの申し込み', [
      '■予約依頼番号： HP-103',
      '■来店日時：2026年8月30日(日) 18:30',
      '■代表者：テスト 太郎様',
      '■席情報：テーブル席',
      '　窓側希望',
      '■人数：2名様',
    ].join('\n'));
    expect(result.tableLabel).toBe('テーブル席\n窓側希望');
  });

  it('電話番号のハイフン有無を同じ数字列へ正規化する', () => {
    const withHyphens = parse('retty', '予約', RETTY_DETAILS).customerPhone;
    const withoutHyphens = parse('retty', '予約', RETTY_DETAILS.replace('090-0000-0000', '09000000000')).customerPhone;
    expect(withHyphens).toBe('09000000000');
    expect(withoutHyphens).toBe(withHyphens);
  });

  it('年がないRetty予約は来店日時を作らない', () => {
    const result = parse('retty', '予約', RETTY_DETAILS.replace('2026年', ''));
    expect(result.startsAt).toBeUndefined();
  });
});
