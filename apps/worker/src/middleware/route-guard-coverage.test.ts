import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 更新系の経路に、役割の指定が付いているかを機械的に確かめる。
 *
 * requireRole の仕組みは前からあったのに、3ファイルにしか使われていなかった。
 * 付け忘れても何も起きないので気づけなかった、というのが原因だと考えている。
 * このテストは「新しい更新系APIを足したのに権限を書き忘れた」ときに落ちる。
 *
 * まだ全経路にガードを付け終えていないため、いまは ALLOWLIST で未対応分を
 * 明示している。ガードを足すたびに ALLOWLIST から消していき、最後に空になる。
 * 逆に、ALLOWLIST に無い新しい経路が無防備だと即座に落ちる。
 */

const ROUTES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'routes');

/** 認証そのものを通さない公開経路。権限の対象外。 */
const PUBLIC_PREFIXES = [
  // /admin/update/* は x-admin-api-key での専用認証を router 自身が持つ。
  // 通常の認証を通らないので c.get('staff') が無く、requireRole は使えない。
  '/start',
  '/status/',
  '/stream/',
  '/api/liff/',
  '/api/integrations/',
  '/webhook',
  '/webhooks/xserver/',
  '/api/affiliates/click',
  '/auth/',
  '/api/auth/',
  '/setup',
  '/api/meet-callback',
  '/t/',
  '/r/',
  '/pool/',
  '/api/forms/',
  // サイトスクリプトの受け口。外のサイトのブラウザから直接叩かれるので
  // 認証が置けない（鍵を置いてもページのソースに出る）。
  // 代わりにレート制限を掛け、受け取る中身を絞り、何も返さない。
  '/api/site/',
];

/**
 * 役割ガードを付けていない更新系。
 *
 * 0.22.0 で全て潰し終えた。ここが空である限り、権限を決めずに更新系APIを
 * 足すとテストが落ちる。追記して回避してはいけない。追記が必要になったのは、
 * 権限を決めずにAPIを足したということ。
 *
 * admin-auth と meet-callback は認証そのものを通さない公開経路なので、
 * PUBLIC_PREFIXES 側で対象外になっている。
 */
const ALLOWLIST = new Set<string>([]);

const MUTATING = /\.(post|put|patch|delete)\(\s*'([^']+)'/g;

type Finding = { file: string; method: string; path: string };

function collectUnguarded(): Finding[] {
  const findings: Finding[] = [];
  for (const entry of readdirSync(ROUTES_DIR)) {
    if (!entry.endsWith('.ts') || entry.includes('.test.')) continue;
    const source = readFileSync(join(ROUTES_DIR, entry), 'utf8');
    const guarded = source.includes('requireRole');
    if (guarded) continue;
    for (const match of source.matchAll(MUTATING)) {
      const [, method, path] = match;
      if (PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix))) continue;
      findings.push({ file: entry.replace(/\.ts$/, ''), method, path });
    }
  }
  return findings;
}

describe('更新系の権限ガードの網羅', () => {
  it('役割ガードの無い更新系は、既知の未対応分だけであること', () => {
    const unexpected = [...new Set(collectUnguarded().map((f) => f.file))]
      .filter((file) => !ALLOWLIST.has(file))
      .sort();
    expect(
      unexpected,
      `役割ガードの無い更新系APIが増えています: ${unexpected.join(', ')}\n` +
        '権限対応表に沿って requireRole を付けてください。ALLOWLIST への追記で回避しないこと。',
    ).toEqual([]);
  });

  it('ガード済みのファイルは ALLOWLIST に残っていないこと', () => {
    // 付け終わったのに ALLOWLIST に残っていると、次の付け忘れを見逃す。
    const stillListed: string[] = [];
    for (const entry of readdirSync(ROUTES_DIR)) {
      if (!entry.endsWith('.ts') || entry.includes('.test.')) continue;
      const name = entry.replace(/\.ts$/, '');
      if (!ALLOWLIST.has(name)) continue;
      const source = readFileSync(join(ROUTES_DIR, entry), 'utf8');
      if (source.includes('requireRole')) stillListed.push(name);
    }
    expect(
      stillListed,
      `ガードを付け終えたので ALLOWLIST から消してください: ${stillListed.join(', ')}`,
    ).toEqual([]);
  });

  it('未対応の残数を可視化する（減っていくことを確認するため）', () => {
    const remaining = new Set(collectUnguarded().map((f) => f.file)).size;
    // 0 になったら ALLOWLIST ごと削除してよい。
    expect(remaining).toBeLessThanOrEqual(ALLOWLIST.size);
  });
});
