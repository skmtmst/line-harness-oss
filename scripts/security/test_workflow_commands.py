import tempfile
import unittest
from pathlib import Path

from check_workflow_commands import inspect_workflow, missing_scripts


class WorkflowCommandsTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / 'scripts').mkdir()
        (self.root / 'scripts/kept.mjs').touch()

    def test_existing_script_and_quoted_argument(self):
        self.assertEqual(missing_scripts('node "scripts/kept.mjs"', self.root), [])

    def test_directory_is_not_an_executable_file(self):
        (self.root / 'scripts/directory.mjs').mkdir()
        self.assertEqual(missing_scripts('node scripts/directory.mjs', self.root), ['scripts/directory.mjs'])

    def test_deleted_interpreter_entry_fails(self):
        for prefix in ('node', 'pnpm tsx', 'pnpm exec tsx', 'pnpm --silent exec tsx', 'bash', 'python3'):
            with self.subTest(prefix=prefix):
                self.assertEqual(missing_scripts(f'{prefix} scripts/deleted.mjs', self.root), ['scripts/deleted.mjs'])

    def test_environment_assignment_does_not_hide_deleted_python_entry(self):
        self.assertEqual(missing_scripts(
            'PYTHONDONTWRITEBYTECODE=1 python3 scripts/deleted.py', self.root,
        ), ['scripts/deleted.py'])

    def test_deleted_file_after_browser_host_fails(self):
        self.assertEqual(missing_scripts(
            'node scripts/kept.mjs --test --test-concurrency=1 scripts/kept.mjs scripts/deleted.mjs',
            self.root,
        ), ['scripts/deleted.mjs'])

    def test_program_data_arguments_are_not_interpreter_entries(self):
        self.assertEqual(missing_scripts(
            'pnpm tsx scripts/kept.mjs --worker apps/worker/dist-release/index.js', self.root,
        ), [])
        self.assertEqual(missing_scripts('node scripts/deleted.mjs -c data', self.root), ['scripts/deleted.mjs'])

    def test_multiline_arguments_and_globs(self):
        self.assertEqual(missing_scripts('node --test \\\n  scripts/*.mjs', self.root), [])
        self.assertEqual(missing_scripts('node --test scripts/*.test.mjs', self.root), ['scripts/*.test.mjs'])

    def test_comments_and_inline_code_are_not_executed(self):
        self.assertEqual(missing_scripts(
            '# node scripts/deleted.mjs\n'
            'node -e "console.log(\'scripts/deleted.mjs\')" # scripts/deleted.mjs\n'
            'echo node scripts/deleted.mjs', self.root,
        ), [])
        self.assertEqual(missing_scripts(
            "node --input-type=module -e '\nconsole.log(\"scripts/deleted.mjs\")\n'", self.root,
        ), [])
        self.assertEqual(missing_scripts('node --eval "scripts/deleted.mjs"', self.root), [])

    def test_variable_paths_are_outside_static_scope_but_literal_paths_are_checked(self):
        self.assertEqual(missing_scripts(
            'node "$ROOT/scripts/generated.mjs"\nnode packages/cli/dist/index.js', self.root,
        ), ['packages/cli/dist/index.js'])

    def test_working_directory_precedence(self):
        (self.root / 'apps/web/scripts').mkdir(parents=True)
        (self.root / 'apps/web/scripts/local.mjs').touch()
        for defaults in ('workflow', 'job', 'step'):
            document = {'jobs': {'check': {'steps': [{'run': 'node scripts/local.mjs'}]}}}
            job = document['jobs']['check']
            if defaults == 'step':
                job['steps'][0]['working-directory'] = 'apps/web'
            else:
                target = document if defaults == 'workflow' else job
                target['defaults'] = {'run': {'working-directory': 'apps/web'}}
            with self.subTest(defaults=defaults):
                self.assertEqual(inspect_workflow(document, self.root), [])

    def test_if_false_does_not_hide_deleted_source(self):
        document = {'jobs': {'guard': {'steps': [{
            'name': 'broken', 'if': 'false', 'run': 'node scripts/deleted.mjs',
        }]}}}
        self.assertEqual(inspect_workflow(document, self.root), [
            'guard / broken: missing source script scripts/deleted.mjs',
        ])


if __name__ == '__main__':
    unittest.main()
