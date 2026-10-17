import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { evaluateDeploymentSafety, inspectDeployment, REQUIRED_SECURITY_SECRETS, type SafetySnapshot } from './deployment-safety.js';
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
  it.each(['worker','staging','admin'])('runs the guard before deployment in %s workflow',name=>{
    const source=readFileSync(`.github/workflows/deploy-cloudflare-${name}.yml`,'utf8');
    expect(source.indexOf('scripts/security/run-deployment-safety.ts')).toBeGreaterThan(0);
    expect(source.indexOf('scripts/security/run-deployment-safety.ts')).toBeLessThan(source.indexOf(name==='admin'?'npx wrangler pages deploy':name==='worker'?'command: deploy --config':'npx wrangler deploy'));
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
