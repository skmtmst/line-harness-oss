export type Finding = { file: string; line: number; kind: string }
export function inspectRoutePending(source: string, file?: string): Finding[]
export function scanRoutePending(root: string): Finding[]
