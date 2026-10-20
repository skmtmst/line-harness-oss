import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { dbFor } from '../services/db-router.js';
import { readHqFormTest } from '../services/hq-templates/form-test.js';
import { HqTemplateError } from '../services/hq-templates/distribution.js';
import { inputJsonBoundary } from '../lib/input-errors.js';

function formTestToken(c:import('hono').Context<Env>) {
  const auth=c.req.header('Authorization');
  return auth?.startsWith('Bearer ')?auth.slice(7):c.req.header('X-Form-Test-Token')??c.req.query('test_token')??null;
}

export const hqFormTests=new Hono<Env>();
hqFormTests.use('/api/liff/hq-form-tests/*',async(c,next)=>{
  c.header('Cache-Control','no-store');c.header('Referrer-Policy','no-referrer');await next();
});
hqFormTests.onError((error,c)=>c.json({success:false,code:error instanceof HqTemplateError?error.code:'UNAVAILABLE',error:'試しのURLと有効期限を確認してください'},error instanceof HqTemplateError?error.status:500));
hqFormTests.get('/api/liff/hq-form-tests/:id',async c=>c.json({success:true,data:await readHqFormTest(dbFor(c.env),c.req.param('id'),formTestToken(c))}));
hqFormTests.post('/api/liff/hq-form-tests/:id/submit',inputJsonBoundary({answers:['object']}),async c=>{
  const text=await c.req.text();
  if(text.length>100_000)throw new HqTemplateError('INVALID_ANSWERS');
  let input:Record<string,unknown>;try{input=JSON.parse(text);}catch{throw new HqTemplateError('INVALID_ANSWERS');}
  if(!input||typeof input!=='object'||Array.isArray(input)||!input.answers)throw new HqTemplateError('INVALID_ANSWERS');
  const data=await readHqFormTest(dbFor(c.env),c.req.param('id'),formTestToken(c),input.answers);
  return c.json({success:true,data});
});
