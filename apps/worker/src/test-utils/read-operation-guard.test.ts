import { expect, it } from 'vitest';
import { registrations } from './route-guards.js';

it.each([
  ['call argument', "app.post('/api/segments/count', requireReadOperationPermission(), handler)", true],
  ['import only', "app.post('/api/segments/count', handler)", false],
  ['unattached call', "requireReadOperationPermission(); app.post('/api/segments/count', handler)", false],
  ['similar name', "app.post('/api/segments/count', requireReadOperationPermissions(), handler)", false],
  ['real import alias', "app.post('/api/segments/count', readGate(), handler)", true],
] as const)('%sだけをASTで正しく数える', (_label, route, guarded) => {
  const source = "import { requireReadOperationPermission, requireReadOperationPermission as readGate } from '../middleware/role-guard.js';\n" + route;
  expect(registrations(source).filter(row => row.method === 'POST').map(row => row.guarded)).toEqual([guarded]);
});

