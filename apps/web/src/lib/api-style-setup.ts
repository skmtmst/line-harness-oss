import type {
AccountStyle,
SetupAnswer,
StyleCard,
StyleTemplateSample
} from '@line-crm/shared';
import { fetchApi } from './api';
import { root,url,write } from './api-style-requests';
import { type Result,type StarterSetItem,type StyleSelection } from './api-styles-types';
export const styleSetupApi = {

  get: (accountId: string) =>
    fetchApi<
      Result<{
        style: AccountStyle;
        styleSelected: boolean;
        styleMode: SetupAnswer['mode'];
        version: number;
        answers: Record<string, SetupAnswer>;
        settings: Record<string, number>;
        cards: StyleCard[];
        questions: Array<{
          key: string;
          changeAt?: string;
          canChangeLater: boolean;
          recommended: string | boolean;
          modes: Array<SetupAnswer['mode']>;
        }>;
      }>
    >(url(root, accountId)),
  save: (accountId: string, body: StyleSelection) =>
    fetchApi<
      Result<{
        style: AccountStyle;
        styleMode: SetupAnswer['mode'];
        styleSelected: boolean;
        version: number;
        inserted: Array<{
          key: string;
          kind: string;
          id: string;
          isSample: boolean;
          requiresActivation: boolean;
        }>;
      }>
    >(url(root, accountId), write('PUT', body)),
  warnings: (accountId: string) =>
    fetchApi<
      Result<{
        count: number;
        items: Array<{
          feature: string;
          areaId: string;
          groupId: string;
          href?: string;
          customerState: 'preparing';
        }>;
        pending: Array<{ key: string; href?: string; mode: string }>;
        manual: Array<{ key: string; href?: string }>;
      }>
    >(url(root + '/warnings', accountId)),
  starterSet: (accountId: string, style: AccountStyle) =>
    fetchApi<
      Result<{
        id: string;
        version: number;
        autoInsert: boolean;
        definition: { items: StarterSetItem[] };
      }>
    >(url(root + '/starter-set', accountId, { style })),
  templateSamples: (accountId: string, style: AccountStyle) =>
    fetchApi<Result<{ style: AccountStyle; items: StyleTemplateSample[] }>>(
      url(root + '/template-samples', accountId, { style }),
    ),
  starterItems: (accountId: string) =>
    fetchApi<
      Result<{
        items: Array<{
          target_id: string;
          kind: string;
          is_sample: number;
          status: string | null;
          draftRevision: string | null;
        }>;
      }>
    >(url(root + '/starter-items', accountId)),
  activate: (
    accountId: string,
    items: Array<{
      id: string;
      kind: 'automation' | 'booking_menu';
      expectedDraftVersionId?: string;
      expectedVersion?: number;
    }>,
  ) =>
    fetchApi<
      Result<{
        complete: boolean;
        items: Array<{
          id: string;
          success: boolean;
          status?: string;
          code?: string;
        }>;
      }>
    >(
      url(root + '/activate', accountId),
      write('POST', { confirmed: true, items }),
    ),
  resources: (accountId: string) =>
    fetchApi<
      Result<{ items: Array<{ id: string; name: string; kind: string }> }>
    >(url(root + '/resources', accountId)),
}
