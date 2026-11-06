export type RoutePendingIssue = { file: string; kind: string; line?: number };
export function inspectRoutePending(source: string, file?: string): RoutePendingIssue[];
export function scanRoutePending(root: string): RoutePendingIssue[];
