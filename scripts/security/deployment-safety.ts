import { unstable_readConfig } from 'wrangler';

export type SafetyConfig = { vars?: Record<string,unknown>; r2_buckets?: Array<{binding:string;bucket_name:string}> };
export type SafetySnapshot = { bindings: Array<{name:string;type:string;text?:string;bucket_name?:string}>; buckets: Array<{name:string;managed:boolean;custom:boolean}> };
export const REQUIRED_SECURITY_SECRETS = ['API_KEY','LINE_CREDENTIAL_ENCRYPTION_KEY','TURNSTILE_SECRET_KEY','GOOGLE_CALENDAR_CREDENTIAL_ENCRYPTION_KEY'] as const;
const productionOrigins = new Set(['https://admin.musubo.jp','https://api.musubo.jp']);
const stagingOrigins = new Set(['https://stg-admin.musubo.jp','https://nen-line-stg-admin.pages.dev','https://stg-api.musubo.jp']);
const secretName = /(?:SECRET|PASSWORD|PRIVATE_KEY|ENCRYPTION_KEY|(?:^|_)API_KEY$|ACCESS_TOKEN$|API_TOKEN$)/;
/** Return names/codes only, never the offending values or provider errors. */
export function evaluateDeploymentSafety(config: SafetyConfig, snapshot: SafetySnapshot, environment: 'production'|'staging'): string[] {
  const failures: string[]=[];
  const checkVars=(vars: Record<string,unknown>, source:string)=>{
    if(vars.DEPLOY_ENV !== environment) failures.push(`${source}:DEPLOY_ENV`);
    for(const [name,value] of Object.entries(vars)) {
      if(secretName.test(name)) failures.push(`${source}:plaintext:${name}`);
      if(environment==='production' && ((/(?:TEST|MOCK|DEMO|SANDBOX|BYPASS)/.test(name) && !['','false','0','off','disabled'].includes(String(value).toLowerCase())) || (/(?:ENVIRONMENT|MODE)$/.test(name) && /^(?:test|mock|demo|sandbox)$/.test(String(value).toLowerCase())))) failures.push(`${source}:test-flag:${name}`);
    }
    const origins=typeof vars.ADMIN_ORIGIN==='string'?vars.ADMIN_ORIGIN.split(',').map(s=>s.trim()):[];
    // Resolve the same public admin default as the runtime when ADMIN_ORIGIN is absent.
    if(!origins.length && typeof vars.ADMIN_PUBLIC_URL==='string') origins.push(vars.ADMIN_PUBLIC_URL);
    if(!origins.length || origins.some(origin=>!(environment==='production'?productionOrigins:stagingOrigins).has(origin))) failures.push(`${source}:ADMIN_ORIGIN`);
  };
  checkVars(config.vars??{},'candidate');
  checkVars(Object.fromEntries(snapshot.bindings.filter(b=>b.type==='plain_text').map(b=>[b.name,b.text])),'deployed');
  for(const name of REQUIRED_SECURITY_SECRETS) if(!snapshot.bindings.some(b=>b.name===name&&b.type==='secret_text')) failures.push(`missing-secret:${name}`);
  for(const bucket of config.r2_buckets??[]) {
    if(!snapshot.bindings.some(b=>b.type==='r2_bucket'&&b.name===bucket.binding&&b.bucket_name===bucket.bucket_name)) failures.push(`bucket-drift:${bucket.binding}`);
    const found=snapshot.buckets.find(b=>b.name===bucket.bucket_name);
    if(!found || found.managed || found.custom) failures.push(`public-bucket:${bucket.binding}`);
  }
  if(snapshot.buckets.some(b=>b.managed||b.custom)) failures.push('public-bucket:deployed-r2');
  return [...new Set(failures)];
}
export async function inspectDeployment(configPath:string, environment:'production'|'staging', token:string, account:string, fetchImpl:typeof fetch=fetch):Promise<string[]> {
  if(!token || !account) throw new Error('deployment_safety_credentials_missing');
  // Wrangler parses the exact config used by deploy, including multiline TOML.
  const config=unstable_readConfig({config:configPath});
  const get=async(path:string):Promise<any>=>{
    const res=await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/${path}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
    if(!res.ok) throw new Error(`deployment_safety_metadata_unavailable:${res.status}:${path.split('/')[0].replace(/[^a-z0-9_-]/gi,'')}`);
    const body=await res.json() as {success:boolean;result:unknown};
    if(body.success!==true || !body.result) throw new Error('deployment_safety_metadata_invalid');
    return body.result;
  };
  if (process.env.SECURITY_ADMIN_TEST_ENABLED) config.vars.NEXT_PUBLIC_RESTAURANT_TEST_ENABLED = process.env.SECURITY_ADMIN_TEST_ENABLED;
  const name=process.env.SECURITY_WORKER_NAME || config.name;
  const settings=await get(`workers/scripts/${encodeURIComponent(name)}/settings`);
  if(!Array.isArray(settings.bindings)) throw new Error('deployment_safety_bindings_unknown');
  const buckets=[];
  const deployedBuckets=settings.bindings.filter((b:any)=>b.type==='r2_bucket');
  if(deployedBuckets.some((b:any)=>typeof b.bucket_name!=='string'||!b.bucket_name))throw new Error('deployment_safety_bucket_unknown');
  const bucketNames=new Set([...(config.r2_buckets??[]).map((b:{bucket_name:string})=>b.bucket_name),...deployedBuckets.map((b:any)=>b.bucket_name as string)]);
  for(const bucketName of bucketNames) {
    const root=`r2/buckets/${encodeURIComponent(bucketName)}/domains`;
    const managed=await get(`${root}/managed`), custom=await get(`${root}/custom`);
    if(typeof managed.enabled!=='boolean'||!Array.isArray(custom.domains)||custom.domains.some((d:any)=>typeof d.enabled!=='boolean')) throw new Error('deployment_safety_bucket_unknown');
    buckets.push({name:bucketName,managed:managed.enabled,custom:custom.domains.some((d:any)=>d.enabled)});
  }
  return evaluateDeploymentSafety(config as SafetyConfig,{bindings:settings.bindings,buckets},environment);
}
