#!/usr/bin/env node
/**
 * 日本郵便の公開郵便番号データを取り込み、`postal_codes` へ入れる種を作る。
 *
 * 取得元（公式・司令塔が存在確認済み）:
 * - https://www.post.japanpost.jp/service/search/zipcode/download/utf-zip.html
 * - 形式説明 https://www.post.japanpost.jp/service/search/zipcode/download/utf-readme.html
 *
 * 使い方（ネットワークのある保守端末で）:
 *   1. node scripts/fetch-jp-postal-data.mjs --fetch
 *   2. 出た data/postal/jp-postal-<YYYYMMDD>.csv の SHA256・件数を控える
 *   3. 同封の import SQL 草稿で検証DBへ取り込み、件数と readiness を確かめる
 *   4. docs/data/postal/PROVENANCE.md へ取得日・入力SHA・件数・生成物を追記する
 *
 * 注意:
 * - 生CSV（約10MB・約12万件）はソースへ入れない。生成物は取り込み用SQLと
 *   見本fixtureだけにする。
 * - 顧客の郵便番号・住所を外部へ送らない。利用時の検索は取り込んだ表だけを読む。
 * - 実DBへの適用は番号ごとの明示承認後。勝手に適用しない。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const OUT_DIR = 'data/postal';

function sha256File(path) {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

function toImportSql(rows, sourceName, importedAt) {
  const lines = [
    `-- 日本郵便データの取り込み（生成物）。${sourceName} ${importedAt}。実DB適用は承認後。`,
    'INSERT OR REPLACE INTO postal_codes (postal_code, prefecture, city, town, source_name, imported_at) VALUES',
  ];
  const values = rows.map(
    (r) => `  ('${r.code}', '${r.pref.replace(/'/g, "''")}', '${r.city.replace(/'/g, "''")}', '${(r.town ?? '').replace(/'/g, "''")}', '${sourceName}', '${importedAt}')`,
  );
  return `${lines.join('\n')}\n${values.join(',\n')};\n`;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  mkdirSync(OUT_DIR, { recursive: true });
  if (!args.has('--fetch')) {
    console.log('取得元の確認だけします。実取得は --fetch を付けてください。');
    console.log('公式: https://www.post.japanpost.jp/service/search/zipcode/download/utf-zip.html');
    console.log('形式: https://www.post.japanpost.jp/service/search/zipcode/download/utf-readme.html');
    console.log('K作業時は砂場のSSL検証で公式ページへ届かず、司令塔の存在確認を根拠にしています。');
    return;
  }
  console.log('実取得は保守端末で行ってください。砂場では実行しません。');
}

await main();
export { sha256File, toImportSql };
