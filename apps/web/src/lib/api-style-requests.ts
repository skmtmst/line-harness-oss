import type {
AccountStyle,
StyleTemplateSample
} from '@line-crm/shared';
import { fetchApi } from './api';
import { type Result,type StarterSetItem,type StyleStarterSet } from './api-styles-types';



export const root = '/api/dashboard/style';

export const url = (
  path: string,
  accountId: string,
  query: Record<string, string | undefined> = {},
) =>
  `${path}?${new URLSearchParams({ account_id: accountId, ...Object.fromEntries(Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined)) })}`;

export const write = (method: string, body: unknown) => ({
  method,
  body: JSON.stringify(body),
});

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
