export type VisualRoute = { name: string; path: string; type: string; [key: string]: unknown }
export const ROUTES: VisualRoute[]
export const NOT_READY: VisualRoute[]
export const TAG_STATES: { name: string; label: string; status: number; body: unknown; statsBody?: unknown }[]
export const WIDTHS: number[]
