export interface ActionBody {
  hook?: string;
  stepId?: string | null;
  choiceIndex?: number | null;
  actionType?: string;
  config?: unknown;
  condition?: unknown;
  repeatOnRefire?: boolean;
  sortOrder?: number;
}
