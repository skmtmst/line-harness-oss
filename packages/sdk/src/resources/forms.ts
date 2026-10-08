import type { HttpClient } from '../http.js'
import type {
  ApiResponse,
  Form,
  FormSubmission,
  CreateFormInput,
  UpdateFormInput,
} from '../types.js'

export class FormsResource {
  constructor(private readonly http: HttpClient, private readonly defaultAccountId?: string) {}

  private scopedPath(path: string, params?: { accountId?: string }): string {
    const accountId = params?.accountId ?? this.defaultAccountId
    return accountId ? `${path}?account_id=${encodeURIComponent(accountId)}` : path
  }

  async list(params?: { accountId?: string }): Promise<Form[]> {
    const res = await this.http.get<ApiResponse<Form[]>>(this.scopedPath('/api/forms', params))
    return res.data
  }

  async get(id: string, params?: { accountId?: string }): Promise<Form> {
    const res = await this.http.get<ApiResponse<Form>>(this.scopedPath(`/api/forms/${id}`, params))
    return res.data
  }

  async create(input: CreateFormInput): Promise<Form> {
    const res = await this.http.post<ApiResponse<Form>>('/api/forms', { ...input, accountId: input.accountId ?? this.defaultAccountId })
    return res.data
  }

  async update(id: string, input: UpdateFormInput, params?: { accountId?: string }): Promise<Form> {
    const res = await this.http.put<ApiResponse<Form>>(this.scopedPath(`/api/forms/${id}`, params), input)
    return res.data
  }

  async delete(id: string, params?: { accountId?: string; expectedRevision?: number }): Promise<void> {
    const path = this.scopedPath(`/api/forms/${id}`, params)
    const query = params?.expectedRevision === undefined ? '' : `${path.includes('?') ? '&' : '?'}expected_revision=${params.expectedRevision}`
    await this.http.delete(`${path}${query}`)
  }

  async getSubmissions(formId: string, params?: { accountId?: string }): Promise<FormSubmission[]> {
    const res = await this.http.get<ApiResponse<FormSubmission[]>>(
      this.scopedPath(`/api/forms/${formId}/submissions`, params),
    )
    return res.data
  }
}
