import type { AccountStyle, StyleTemplateSample } from '@line-crm/shared';
import { fetchApi } from './api';

import { write, Result, StarterSetItem, StyleStarterSet } from './api-styles-common.js';
export type * from './api-styles-common.js';
import { methods1 } from './api-style-methods-1.js';
import { methods2 } from './api-style-methods-2.js';
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
  attention: () =>
    fetchApi<
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
