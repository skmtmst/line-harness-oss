export type Finding = { file: string; line: number; kind: string }
export function inspectDialogFooters(source: string, file?: string): Finding[]
export function scanDialogFooters(root: string): Finding[]
