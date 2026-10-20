#!/usr/bin/env python3
import copy
from pathlib import Path
import unittest
from check_production_workflows import check, load, PARENT, CHILDREN


class ProductionWorkflowTest(unittest.TestCase):
    def setUp(self):
        self.workflows = load(Path(__file__).resolve().parents[2])

    def test_real_release(self):
        check(self.workflows)

    def test_release_order_mutations(self):
        for child, dependency in [('database', 'worker'), ('worker', 'authorize'), ('admin', 'database')]:
            with self.subTest(child=child):
                changed = copy.deepcopy(self.workflows)
                changed[PARENT]['jobs'][child]['needs'] = dependency
                with self.assertRaisesRegex(ValueError, 'release_dependency'):
                    check(changed)

    def test_apply_before_backup_is_rejected(self):
        job = self.workflows[CHILDREN['database']]['jobs']['migrate']
        steps = job['steps']
        backup = next(i for i, s in enumerate(steps) if 'production/run.ts backup' in s.get('run', ''))
        apply = next(i for i, s in enumerate(steps) if 'production/run.ts apply' in s.get('run', ''))
        steps[backup], steps[apply] = steps[apply], steps[backup]
        with self.assertRaisesRegex(ValueError, 'unsafe_step_order'):
            check(self.workflows)

    def test_missing_backup_and_header_checks_are_rejected(self):
        for child, command in [('database', 'backup'), ('worker', 'worker-artifact'), ('admin', 'admin-artifact'), ('worker', 'worker-responses'), ('admin', 'admin-responses')]:
            with self.subTest(command=command):
                changed = copy.deepcopy(self.workflows)
                job = next(iter(changed[CHILDREN[child]]['jobs'].values()))
                job['steps'] = [s for s in job['steps'] if f'production/run.ts {command}' not in s.get('run', '')]
                with self.assertRaises(ValueError):
                    check(changed)

    def test_independent_push_or_dispatch_is_rejected(self):
        for filename in CHILDREN.values():
            for trigger in ['push', 'workflow_dispatch']:
                with self.subTest(filename=filename, trigger=trigger):
                    changed = copy.deepcopy(self.workflows)
                    changed[filename][True][trigger] = {}
                    with self.assertRaisesRegex(ValueError, 'reusable_child_only'):
                        check(changed)

    def test_failure_bypass_and_sha_drift_are_rejected(self):
        for mutation in ['always', 'continue', 'sha', 'approval', 'lock', 'checkout', 'public_backup']:
            with self.subTest(mutation=mutation):
                changed = copy.deepcopy(self.workflows)
                call = changed[PARENT]['jobs']['admin']
                job = changed[CHILDREN['worker']]['jobs']['deploy']
                if mutation == 'always': call['if'] = 'always()'
                elif mutation == 'continue': job['steps'][-1]['continue-on-error'] = True
                elif mutation == 'sha': call['with']['release_sha'] = 'main'
                elif mutation == 'approval': job.pop('environment')
                elif mutation == 'lock': changed[PARENT]['concurrency']['cancel-in-progress'] = True
                elif mutation == 'checkout': job['steps'][0]['with']['ref'] = 'main'
                elif mutation == 'public_backup': job['steps'].append({'uses': 'actions/upload-artifact@sha'})
                with self.assertRaises(ValueError):
                    check(changed)


if __name__ == '__main__':
    unittest.main()
