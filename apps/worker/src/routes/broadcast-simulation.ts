import {BROADCAST_DEFINITION_EDIT_KEY,BROADCAST_DEFINITION_PUBLISH_KEY} from '@line-crm/shared';
import {Hono} from 'hono';
import type { Env } from '../worker-env.js';
import {requirePermission} from '../middleware/role-guard.js';
import {GapError,gapAccount,gapBody,gapKey,gapWrite} from '../services/gap-common.js';
import {saveSimulationDraft,simulationPreview,scheduleSimulation,processBroadcastSimulation} from '../features/broadcasts/broadcast-simulation/index.js';
export const broadcastSimulation=new Hono<Env>();
broadcastSimulation.use('/api/broadcasts/*',requirePermission('/broadcasts'));
broadcastSimulation.onError((e,c)=>c.json({success:false,error:e instanceof GapError?e.code:/CHECK constraint/.test(String(e))?'version_conflict':'simulation_unavailable'},e instanceof GapError?e.status:/CHECK constraint/.test(String(e))?409:503));
broadcastSimulation.post('/api/broadcasts/simulation-drafts',requirePermission(BROADCAST_DEFINITION_EDIT_KEY),async c=>{gapWrite(c);const a=await gapAccount(c),b=await gapBody(c);const r=await saveSimulationDraft(c.env.DB,a,c.get('staff').id,gapKey(c),b);return c.json({success:true,data:{...r,...await simulationPreview(c.env.DB,r.id)}},201);});
broadcastSimulation.put('/api/broadcasts/:id/simulation-draft',requirePermission(BROADCAST_DEFINITION_EDIT_KEY),async c=>{gapWrite(c);const a=await gapAccount(c),b=await gapBody(c),r=await saveSimulationDraft(c.env.DB,a,c.get('staff').id,'update',b,c.req.param('id'));return c.json({success:true,data:{...r,...await simulationPreview(c.env.DB,r.id)}});});
broadcastSimulation.get('/api/broadcasts/:id/simulation',async c=>{
 const a=await gapAccount(c);if(!await c.env.DB.prepare('SELECT id FROM broadcasts WHERE id=? AND line_account_id=?').bind(c.req.param('id'),a).first())throw new GapError('not_found',404);
 return c.json({success:true,data:await simulationPreview(c.env.DB,c.req.param('id'))});
});
broadcastSimulation.post('/api/broadcasts/:id/simulate-send',requirePermission(BROADCAST_DEFINITION_PUBLISH_KEY),async c=>{
 gapWrite(c);const a=await gapAccount(c);if(!await c.env.DB.prepare('SELECT id FROM broadcasts WHERE id=? AND line_account_id=?').bind(c.req.param('id'),a).first())throw new GapError('not_found',404);
 const b=await gapBody(c),result=await scheduleSimulation(c.env.DB,c.req.param('id'),b,gapKey(c));await processBroadcastSimulation(c.env.DB,c.req.param('id'));return c.json({success:true,data:{...result,...await simulationPreview(c.env.DB,c.req.param('id'))}});
});
