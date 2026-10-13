/** 検証で配備するソースの版とSHAを、組み立て前に埋める。 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function stampStagingVersion(root: string, releasedAt = new Date().toISOString()) {
  // config replayでは GITHUB_SHA と配備するソースのHEADが異なる。
  const commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('配備するソースのSHAを確認できません');
  const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) throw new Error('版を確認できません');
  const path = resolve(root, 'apps/worker/src/_version.ts');
  let source = readFileSync(path, 'utf8');
  for (const [key, value] of Object.entries({ BUNDLE_VERSION: version, RELEASED_AT: releasedAt, GIT_COMMIT: commit })) {
    const pattern = new RegExp(`export const ${key} = [^;]+;`);
    if (!pattern.test(source)) throw new Error(`版の定数がありません: ${key}`);
    source = source.replace(pattern, () => `export const ${key} = ${JSON.stringify(value)};`);
  }
  writeFileSync(path, source);
  return { version, commit, releasedAt };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(stampStagingVersion(resolve(process.argv[2] ?? '.'))));
}
