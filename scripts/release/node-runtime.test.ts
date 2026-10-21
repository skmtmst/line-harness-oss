import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';

it('builds release artifacts with the same Node major as tested and staging artifacts',()=>{
 const majors=(file:string)=>[...readFileSync(new URL(`../../.github/workflows/${file}`,import.meta.url),'utf8')
  .matchAll(/^\s+node-version:\s*['"]?(\d+)/gm)].map(match=>Number(match[1]));
 const tested=majors('worker-ci.yml'),staging=majors('deploy-cloudflare-staging.yml'),release=majors('release.yml');
 expect(tested.length).toBeGreaterThan(0);expect(staging.length).toBeGreaterThan(0);expect(release.length).toBeGreaterThan(0);
 expect(new Set([...tested,...staging,...release]).size).toBe(1);
});

it('runs every workflow command with the approved October security patch', () => {
 const directory = new URL('../../.github/workflows/', import.meta.url);
 const versions: string[] = [];
 for (const file of readdirSync(directory).filter(file => /\.ya?ml$/.test(file))) {
  const workflow = readFileSync(new URL(file, directory), 'utf8');
  const setups = [...workflow.matchAll(/uses:\s*actions\/setup-node@/g)];
  const inputs = [...workflow.matchAll(/^\s+node-version:\s*['"]?([^'"\s]+)['"]?\s*$/gm)];
  expect(inputs.length, `${file}: every setup-node needs an explicit runtime`).toBe(setups.length);
  for (const input of inputs) {
   expect(input[1], `${file}: must not reuse an older cached runtime`).toBe('22.23.4');
   versions.push(input[1]);
  }
 }
 expect(versions.length).toBeGreaterThan(0);
});
