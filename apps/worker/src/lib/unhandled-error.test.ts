import { afterEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
const report=vi.hoisted(()=>vi.fn(async()=>false));
vi.mock('../services/codex-slack-relay.js',()=>({reportHarnessErrorToSlack:report}));
import { unhandledWorkerError } from './unhandled-error.js';
afterEach(()=>vi.restoreAllMocks());
it('connects each response to the same safe log and notification ID',async()=>{
 const log=vi.spyOn(console,'error').mockImplementation(()=>{});
 const app=new Hono<Env>();app.get('/api/friends/:id',()=>{throw new Error('private-customer secret-token')});app.onError(unhandledWorkerError);
 const response=await app.request('/api/friends/private-customer?token=secret-token',{},{} as Env['Bindings']);
 const body=await response.json<{incidentId:string}>();
 expect(response.status).toBe(500);expect(body.incidentId).toMatch(/^[0-9a-f-]{36}$/);
 expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({code:'unhandled_worker_error',route:'GET /api/friends/:id',incidentId:body.incidentId});
 expect(report).toHaveBeenLastCalledWith(expect.anything(),{source:'worker',message:'unhandled_worker_error',path:'GET /api/friends/:id',incidentId:body.incidentId});
 expect(JSON.stringify([body,log.mock.calls,report.mock.calls])).not.toMatch(/private-customer|secret-token/);
});
