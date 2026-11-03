export type DialogFooterIssue = { file: string; kind: string; line?: number };
export function inspectDialogFooters(source: string, file?: string): DialogFooterIssue[];
export function scanDialogFooters(root: string): DialogFooterIssue[];
