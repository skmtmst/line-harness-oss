export type TagCsvImportRowCode =
  | "name_required"
  | "name_too_long"
  | "invalid_character"
  | "already_exists"
  | "duplicate_in_file"
  | "folder_not_found"
  | "folder_ambiguous"
  | "folder_changed"
  | "create_failed";
