import type { AccountStyle, StyleTemplateSample } from '@line-crm/shared';
import { fetchApi } from '../../api';
import { fetchSharedRead } from '../transport/cache';

import {
  write,
  Result,
  StarterSetItem,
  StyleStarterSet,
  StarterDistributionInput,
  StarterDistributionPreview,
} from './styles-common';
export type * from './styles-common';
import { methods1 } from './style-methods-1';
import { methods2 } from './style-methods-2';
export const styleApi = { ...methods1, ...methods2 };

export const hqStyleApi = {
  templateSamples: (style: AccountStyle) =>
    fetchApi<Result<{ style: AccountStyle; items: StyleTemplateSample[] }>>(
      '/api/hq/style-template-samples?' + new URLSearchParams({ style }),
    ),
  listStarterSets: () =>
    fetchApi<Result<StyleStarterSet[]>>('/api/hq/style-starter-sets'),
  saveStarterSet: (
    style: AccountStyle,
    body: {
      expectedVersion: number;
      name: string;
      autoInsert?: boolean;
      definition: { items: StarterSetItem[] };
    },
  ) =>
    fetchApi<Result<{ id: string; version: number; autoInsert: boolean }>>(
      '/api/hq/style-starter-sets/' + encodeURIComponent(style),
      write('PUT', body),
    ),
  preflight: (style: AccountStyle, body: StarterDistributionInput) =>
    fetchApi<Result<StarterDistributionPreview>>(
      '/api/hq/style-starter-sets/' + encodeURIComponent(style) + '/preflight',
      write('POST', body),
    ),
  distribute: (
    style: AccountStyle,
    body: StarterDistributionInput & {
      token: string;
      confirmed: true;
      editedAction?: 'notify' | 'new_copy';
    },
  ) =>
    fetchApi<
      Result<{
        accountCount: number;
        items: Array<{
          accountId: string;
          key: string;
          action: string;
          message?: string;
        }>;
      }>
    >(
      '/api/hq/style-starter-sets/' + encodeURIComponent(style) + '/distribute',
      write('POST', body),
    ),
  attention: () =>
    fetchSharedRead<
      Result<{
        asOf: string;
        items: Array<{
          accountId: string;
          style: AccountStyle;
          name: string;
          counts: Record<string, number>;
          details: Record<string, Array<{ id: string; href?: string }>>;
        }>;
      }>
    >('/api/hq/style-attention'),
};
