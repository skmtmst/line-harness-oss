export interface HqTemplateVersion {
  id: string;
  tenant_id: string;
  template_id: string;
  version: number;
  definition_json: string;
  content_hash: string;
  created_by: string | null;
  created_at: string;
}
