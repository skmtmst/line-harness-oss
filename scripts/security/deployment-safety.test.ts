import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { evaluateDeploymentSafety, inspectDeployment, REQUIRED_SECURITY_SECRETS, type SafetySnapshot, type SafetyConfig } from './deployment-safety.js';
const vars={DEPLOY_ENV:'production',ADMIN_ORIGIN:'https://admin.musubo.jp',RESTAURANT_TEST_ENABLED:'false'};
function snapshot():SafetySnapshot { return {bindings:[{name:'IMAGES',type:'r2_bucket',bucket_name:'private-fixture'},...Object.entries(vars).map(([name,text])=>({name,type:'plain_text',text})),...REQUIRED_SECURITY_SECRETS.map(name=>({name,type:'secret_text'}))],buckets:[{name:'private-fixture',managed:false,custom:false}]}; }
const config={vars,r2_buckets:[{binding:'IMAGES',bucket_name:'private-fixture'}]};
describe('deployment safety fails closed on unsafe candidate and deployed metadata',()=>{
  it('accepts a fully private production configuration',()=>expect(evaluateDeploymentSafety(config,snapshot(),'production')).toEqual([]));
  it.each(['RESTAURANT_TEST_ENABLED','AUTH_BYPASS','MOCK_EMAIL'])('rejects enabled %s',name=>expect(evaluateDeploymentSafety({...config,vars:{...vars,[name]:'true'}},snapshot(),'production')).toContain(`candidate:test-flag:${name}`));
  it.each(['https://evil.example','*','http://admin.musubo.jp','https://admin.musubo.jp.evil.example'])('rejects unsafe CORS %s',origin=>expect(evaluateDeploymentSafety({...config,vars:{...vars,ADMIN_ORIGIN:origin}},snapshot(),'production')).toContain('candidate:ADMIN_ORIGIN'));
  it.each(REQUIRED_SECURITY_SECRETS)('rejects absent or plaintext %s without returning its value',name=>{
    const state=snapshot();state.bindings=state.bindings.filter(b=>b.name!==name);state.bindings.push({name,type:'plain_text',text:'fixture-must-never-appear'});
    const failures=evaluateDeploymentSafety(config,state,'production');expect(failures).toContain(`missing-secret:${name}`);expect(JSON.stringify(failures)).not.toContain('fixture-must-never-appear');
  });
  it.each(['managed','custom'] as const)('rejects public R2 through %s',key=>{const state=snapshot();state.buckets[0][key]=true;expect(evaluateDeploymentSafety(config,state,'production')).toContain('public-bucket:IMAGES');});
  it('checks the real staging config using simulated Cloudflare metadata, with no remote writes',async()=>{
    const {unstable_readConfig}=await import('wrangler');const path='apps/worker/wrangler.staging.toml';const c=unstable_readConfig({config:path});
    const bindings=[...(c.r2_buckets??[]).map((b:{binding:string;bucket_name:string})=>({name:b.binding,type:'r2_bucket',bucket_name:b.bucket_name})),...Object.entries(c.vars).map(([name,text])=>({name,type:'plain_text',text})),...REQUIRED_SECURITY_SECRETS.map(name=>({name,type:'secret_text'}))];
    const urls:string[]=[];
    const fake=(async(url:any,init:any)=>{urls.push(String(url));expect(init.method??'GET').toBe('GET');return Response.json({success:true,result:String(url).endsWith('/settings')?{bindings}:String(url).endsWith('/managed')?{enabled:false}:{domains:[]}});}) as typeof fetch;
    expect(await inspectDeployment(path,'staging','fixture-token','fixture-account',fake)).toEqual([]);expect(urls).toHaveLength(5);
  });
  function assertGuardBeforePublish(source: string, name: 'worker' | 'staging' | 'admin') {
    const publication = source.indexOf(name === 'staging' ? 'npx wrangler deploy' : `run: pnpm exec tsx scripts/deploy/production/run.ts deploy-${name}`);
    const guards = [...source.matchAll(/^\s+run: pnpm exec tsx scripts\/security\/run-deployment-safety\.ts[^\n]*/gm)];
    expect(publication).toBeGreaterThan(0);
    // Worker must inspect both source and exact generated config, before publishing.
    expect(guards).toHaveLength(name === 'worker' ? 2 : 1);
    for (const guard of guards) expect(guard.index).toBeLessThan(publication);
  }
  it.each(['worker','staging','admin'] as const)('runs the guard before deployment in %s workflow', name => {
    assertGuardBeforePublish(readFileSync(`.github/workflows/deploy-cloudflare-${name}.yml`, 'utf8'), name);
  });
  it.each(['worker','admin'] as const)('rejects a missing guard or a guard moved after %s publication', name => {
    const source = readFileSync(`.github/workflows/deploy-cloudflare-${name}.yml`, 'utf8');
    const guard = [...source.matchAll(/^\s+run: pnpm exec tsx scripts\/security\/run-deployment-safety\.ts[^\n]*/gm)].at(-1)![0];
    expect(() => assertGuardBeforePublish(source.replace(guard, ''), name)).toThrow();
    expect(() => assertGuardBeforePublish(source.replace(guard, '') + '\n' + guard, name)).toThrow();
  });
});

it('fails closed on unavailable or malformed Cloudflare metadata and never returns provider error text',async()=>{
  for(const response of [new Response('fixture-private-provider-error',{status:403}),Response.json({success:false,errors:[{message:'fixture-private-provider-error'}]}),Response.json({success:true,result:{bindings:[]}})]) {
    await expect(inspectDeployment('apps/worker/wrangler.staging.toml','staging','fixture-token','fixture-account',(async()=>response.clone()) as typeof fetch)).rejects.toThrow(/^deployment_safety_/);
  }
});

it('detects an extra public deployed bucket and a changed IMAGES binding',()=>{
 const state=snapshot();state.bindings[0].bucket_name='other-private';state.buckets.push({name:'other-private',managed:false,custom:true});
 const failures=evaluateDeploymentSafety(config,state,'production');expect(failures).toContain('bucket-drift:IMAGES');expect(failures).toContain('public-bucket:deployed-r2');
 expect(REQUIRED_SECURITY_SECRETS).not.toContain('TOTP_ENCRYPTION_KEY');
});

describe('配備の仕組みから呼ぶ入口（run-deployment-safety.ts）', () => {
  it('配備と同じ tsx の実行で本当に動き、引数が正しくなければ失敗で止まる（黙って通らない）', async () => {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/security/run-deployment-safety.ts', 'bad', 'x'], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('deployment_safety_arguments_invalid');
  }, 30000);
});


describe('本番の実設定と管理画面buildの整合', () => {
  afterEach(() => vi.unstubAllEnvs());
  async function realConfig(environment: 'production' | 'staging') {
    const { unstable_readConfig } = await import('wrangler');
    return unstable_readConfig({ config: environment === 'production' ? 'apps/worker/wrangler.toml' : 'apps/worker/wrangler.staging.toml' });
  }
  function privateState(c: SafetyConfig): SafetySnapshot {
    return {
      bindings: [
        ...Object.entries(c.vars ?? {}).map(([name, text]) => ({ name, type: 'plain_text', text: String(text) })),
        ...(c.r2_buckets ?? []).map(b => ({ name: b.binding, type: 'r2_bucket', bucket_name: b.bucket_name })),
        ...REQUIRED_SECURITY_SECRETS.map(name => ({ name, type: 'secret_text' })),
      ],
      buckets: (c.r2_buckets ?? []).map(b => ({ name: b.bucket_name, managed: false, custom: false })),
    };
  }
  it.each(['production', 'staging'] as const)('%s のWorkerと画面の旗が一致し、例外なしで見張りを通る', async environment => {
    const c = await realConfig(environment);
    const workflow = readFileSync(`.github/workflows/deploy-cloudflare-${environment === 'production' ? 'admin' : 'staging'}.yml`, 'utf8');
    const publicFlags: Record<string, string> = {};
    for (const name of ['GOOGLE_BUSINESS_ENABLED', 'RESTAURANT_TEST_ENABLED']) {
      const publicName = `NEXT_PUBLIC_${name}`;
      const value = workflow.match(new RegExp(`^\\s*${publicName}: '([^']+)'$`, 'm'))?.[1];
      expect([...workflow.matchAll(new RegExp(`^\\s*${publicName}:`, 'gm'))]).toHaveLength(1);
      expect(value).toBe(c.vars[name]);
      expect(value).toBe(name === 'GOOGLE_BUSINESS_ENABLED' || environment === 'staging' ? 'true' : 'false');
      publicFlags[publicName] = value!;
    }
    expect(workflow).not.toContain('SECURITY_ADMIN_TEST_ENABLED');
    const candidate = { ...c, vars: { ...c.vars, ...publicFlags } };
    expect(evaluateDeploymentSafety(candidate, privateState(c), environment)).toEqual([]);
    if (environment === 'production') {
      for (const name of ['RESTAURANT_TEST_ENABLED', 'NEXT_PUBLIC_RESTAURANT_TEST_ENABLED']) {
        expect(evaluateDeploymentSafety({ ...candidate, vars: { ...candidate.vars, [name]: 'true' } }, privateState(c), environment)).toContain(`candidate:test-flag:${name}`);
      }
      const live = privateState(c);
      live.bindings.push({ name: 'RESTAURANT_TEST_ENABLED', type: 'plain_text', text: 'true' });
      expect(evaluateDeploymentSafety(candidate, live, environment)).toContain('deployed:test-flag:RESTAURANT_TEST_ENABLED');
    }
    expect(evaluateDeploymentSafety({ ...candidate, vars: { ...candidate.vars, NEXT_PUBLIC_GOOGLE_BUSINESS_ENABLED: 'false' } }, privateState(c), environment)).toContain('candidate:feature-flag-mismatch:GOOGLE_BUSINESS_ENABLED');
  });
  it('本番の実引数・鍵なしのCLIは失敗で止まる', async () => {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/security/run-deployment-safety.ts', 'production', 'apps/worker/wrangler.toml'], {
      encoding: 'utf8', env: { ...process.env, CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ACCOUNT_ID: '' },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('deployment_safety_check_failed');
    expect(r.stdout).not.toContain('"failures":[]');
  }, 30000);
  it('本番で管理画面の試験旗を有効にしたら、実際のinspectでも拒否する', async () => {
    const c = await realConfig('production');
    const bindings = privateState(c).bindings;
    const fake = (async (url: unknown) => Response.json({ success: true, result: String(url).endsWith('/settings') ? { bindings } : String(url).endsWith('/managed') ? { enabled: false } : { domains: [] } })) as typeof fetch;
    vi.stubEnv('NEXT_PUBLIC_RESTAURANT_TEST_ENABLED', 'true');
    expect(await inspectDeployment('apps/worker/wrangler.toml', 'production', 'fixture-token', 'fixture-account', fake)).toContain('candidate:test-flag:NEXT_PUBLIC_RESTAURANT_TEST_ENABLED');
    vi.stubEnv('NEXT_PUBLIC_RESTAURANT_TEST_ENABLED', 'false');
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_BUSINESS_ENABLED', 'true');
    expect(await inspectDeployment('apps/worker/wrangler.toml', 'production', 'fixture-token', 'fixture-account', fake)).toEqual([]);
  });
});
