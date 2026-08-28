import type { HttpClient } from '../http.js'
import type { ApiResponse } from '../types.js'

export interface AdPlatform {
  id: string
  lineAccountId: string
  name: string
  displayName: string | null
  config: Record<string, unknown>
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface AdConversionLog {
  id: string
  lineAccountId: string
  adPlatformId: string
  friendId: string
  eventName: string
  clickId: string | null
  clickIdType: string | null
  status: string
  errorMessage: string | null
  createdAt: string
}

export interface CreateAdPlatformInput {
  lineAccountId: string
  name: 'meta' | 'x' | 'google' | 'tiktok'
  displayName?: string
  config: Record<string, unknown>
}

export interface UpdateAdPlatformInput {
  name?: string
  displayName?: string | null
  config?: Record<string, unknown>
  isActive?: boolean
}

export class AdPlatformsResource {
  constructor(private readonly http: HttpClient) {}

  async list(lineAccountId: string): Promise<AdPlatform[]> {
    const res = await this.http.get<ApiResponse<AdPlatform[]>>(
      `/api/ad-platforms?lineAccountId=${encodeURIComponent(lineAccountId)}`,
    )
    return res.data
  }

  async create(input: CreateAdPlatformInput): Promise<AdPlatform> {
    const res = await this.http.post<ApiResponse<AdPlatform>>('/api/ad-platforms', input)
    return res.data
  }

  async update(id: string, lineAccountId: string, input: UpdateAdPlatformInput): Promise<AdPlatform> {
    const res = await this.http.put<ApiResponse<AdPlatform>>(
      `/api/ad-platforms/${id}?lineAccountId=${encodeURIComponent(lineAccountId)}`,
      input,
    )
    return res.data
  }

  async delete(id: string, lineAccountId: string): Promise<void> {
    await this.http.delete(`/api/ad-platforms/${id}?lineAccountId=${encodeURIComponent(lineAccountId)}`)
  }

  async getLogs(id: string, lineAccountId: string, limit?: number): Promise<AdConversionLog[]> {
    const query = new URLSearchParams({ lineAccountId })
    if (limit !== undefined) query.set('limit', String(limit))
    const path = `/api/ad-platforms/${id}/logs?${query.toString()}`
    const res = await this.http.get<ApiResponse<AdConversionLog[]>>(path)
    return res.data
  }

  async test(
    lineAccountId: string,
    platform: string,
    eventName: string,
    friendId?: string,
  ): Promise<{ message: string }> {
    const res = await this.http.post<ApiResponse<{ message: string }>>('/api/ad-platforms/test', {
      platform,
      eventName,
      friendId,
      lineAccountId,
    })
    return res.data
  }
}
