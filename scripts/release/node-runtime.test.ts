import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('builds release artifacts with the same Node major as tested and staging artifacts',()=>{
 const majors=(file:string)=>[...readFileSync(new URL(`../../.github/workflows/${file}`,import.meta.url),'utf8')
  .matchAll(/^\s+node-version:\s*['"]?(\d+)/gm)].map(match=>Number(match[1]));
 const tested=majors('worker-ci.yml'),staging=majors('deploy-cloudflare-staging.yml'),release=majors('release.yml');
 expect(tested.length).toBeGreaterThan(0);expect(staging.length).toBeGreaterThan(0);expect(release.length).toBeGreaterThan(0);
 expect(new Set([...tested,...staging,...release]).size).toBe(1);
});
