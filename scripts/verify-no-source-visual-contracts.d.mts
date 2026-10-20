export interface SourceAssertion {
  file: string;
  entry: string;
  line: number;
  test: string;
  reads: string[];
  expression: string;
  expected: string[];
  reason: string;
  key: string;
}
export function isTest(path: string): boolean;
export function analyzeSourceTests(files: Map<string, string>, entries?: string[], statementBudget?: number): SourceAssertion[];
export function newSourceAssertions(before: SourceAssertion[], after: SourceAssertion[], moves?: Map<string, string>, sourceFiles?: Map<string, string>): SourceAssertion[];
export function splitModuleMoves(before: Map<string, string>, after: Map<string, string>, moves?: Map<string, string>): Map<string, string>;
export function checkRepository(root: string, base: string): {base: string; examined: number; moves: Record<string, string>; findings: SourceAssertion[]};
