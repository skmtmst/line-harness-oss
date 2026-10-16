import { audit3Paths } from './audit3-openapi.js';
import { auditstepsPaths } from './auditsteps-openapi.js';
import { securityMonitorPaths } from './security-monitor-openapi.js';

export const auditPaths = { ...audit3Paths, ...auditstepsPaths, ...securityMonitorPaths };
