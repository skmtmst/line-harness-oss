import { Hono } from 'hono';
import { getPostalReadiness, normalizePostalQuery, searchPostalCodes, type PostalCodeCandidate } from '@line-crm/db';
import type { Env } from '../index.js';

const postalCode = new Hono<Env>();

/** 内蔵の見本（全量未取り込みでも動く）。全量は `postal_codes` 表へ。 */
const SAMPLE: PostalCodeCandidate[] = [
  { postalCode: '1000001', prefecture: '東京都', city: '千代田区', town: '千代田' },
  { postalCode: '1000001', prefecture: '東京都', city: '千代田区', town: '皇居外苑' },
  { postalCode: '0600000', prefecture: '北海道', city: '札幌市中央区', town: '' },
  { postalCode: '5300001', prefecture: '大阪府', city: '大阪市北区', town: '梅田' },
  { postalCode: '9000000', prefecture: '沖縄県', city: '那覇市', town: '' },
  { postalCode: '4600000', prefecture: '愛知県', city: '名古屋市中区', town: '' },
];

/**
 * F11 郵便番号→住所の検索。
 *
 * 日本郵便の公開データを取り込んだ `postal_codes` 表を読む。利用時の
 * 外部通信はしない。表が無い・0件の環境では内蔵の見本だけで答え、
 * `readiness.fullDataset: false` で未反映を名乗る。
 * 候補が複数ある番号は1つに潰さず全部返す。手入力の住所は保持する
 * （上書きは選んだときだけ）。
 */
postalCode.get('/api/postal-code/search', async (c) => {
  const query = (c.req.query('code') ?? '').trim();
  const normalized = normalizePostalQuery(query);
  const readiness = await getPostalReadiness(c.env.DB);
  if (!normalized) {
    return c.json({
      success: true,
      data: {
        query,
        normalized: null,
        status: 'invalid',
        candidates: [],
        manualEntry: {
          preserved: true,
          note: '郵便番号は 123-4567 のように入力してください。手入力の住所はそのまま残ります。',
        },
        readiness,
      },
    });
  }
  const { candidates, fromDb, total } = await searchPostalCodes(c.env.DB, normalized, SAMPLE);
  return c.json({
    success: true,
    data: {
      query,
      normalized,
      status: candidates.length === 0 ? 'none' : candidates.length === 1 ? 'matched' : 'multiple',
      candidates,
      total,
      fromDb,
      manualEntry: {
        preserved: true,
        note: '候補を選ぶと住所へ入ります。選ばなければ手入力の住所はそのまま残ります。',
      },
      readiness,
    },
  });
});

export { postalCode };
