export class LineHarnessError extends Error {
  readonly code?: string
  readonly requestId?: string
  readonly fields: Record<string, string>
  constructor(
    message: string,
    public readonly status: number,
    public readonly endpoint: string,
    detail: { code?: string; requestId?: string; fieldErrors?: Array<{ field: string; message: string }> } = {},
  ) {
    super(message)
    this.name = 'LineHarnessError'
    this.code = detail.code
    this.requestId = detail.requestId
    this.fields = Object.fromEntries((Array.isArray(detail.fieldErrors) ? detail.fieldErrors : []).filter(item => item !== null && typeof item === 'object' && typeof item.field === 'string' && typeof item.message === 'string').map(item => [item.field, item.message]))
  }
}
