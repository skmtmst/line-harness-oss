import { LineHarnessError } from './errors.js'

interface HttpClientConfig {
  baseUrl: string
  apiKey: string
  timeout: number
}

export class HttpClient {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly timeout: number

  constructor(config: HttpClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.apiKey = config.apiKey
    this.timeout = config.timeout
  }

  async get<T = unknown>(path: string): Promise<T> {
    return this.request<T>('GET', path)
  }

  async post<T = unknown>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('POST', path, body, headers)
  }

  async put<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body)
  }

  async patch<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body)
  }

  async delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>('DELETE', path)
  }

  private async request<T>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    }

    const options: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(this.timeout),
    }

    if (body !== undefined) {
      options.body = JSON.stringify(body)
    }

    const res = await fetch(url, options)

    if (!res.ok) {
      let errorMessage = `HTTP ${res.status}`
      let detail: { code?: string; requestId?: string; fieldErrors?: Array<{ field: string; message: string }> } = { requestId: res.headers?.get('X-Request-ID') ?? undefined }
      try {
        const errorBody = (await res.json()) as { error?: string | { code?: string; message?: string; requestId?: string; fieldErrors?: Array<{ field: string; message: string }> } }
        if (typeof errorBody.error === 'string') errorMessage = errorBody.error
        else if (errorBody.error && typeof errorBody.error === 'object') {
          if (typeof errorBody.error.message === 'string') errorMessage = errorBody.error.message
          detail = { ...detail, code: typeof errorBody.error.code === 'string' ? errorBody.error.code : undefined, requestId: typeof errorBody.error.requestId === 'string' ? errorBody.error.requestId : detail.requestId, fieldErrors: errorBody.error.fieldErrors }
        }
      } catch {
        // ignore parse errors
      }
      throw new LineHarnessError(errorMessage, res.status, `${method} ${path}`, detail)
    }

    return res.json() as Promise<T>
  }
}
