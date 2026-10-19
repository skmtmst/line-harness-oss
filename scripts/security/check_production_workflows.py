#!/usr/bin/env python3
"""Check production entry points, dependency edges and irreversible step order."""
from pathlib import Path
import sys
import yaml

PARENT = 'deploy-cloudflare-production.yml'
CHILDREN = {'database': 'migrate-d1-production.yml', 'worker': 'deploy-cloudflare-worker.yml', 'admin': 'deploy-cloudflare-admin.yml'}


def load(root):
    return {name: yaml.safe_load((Path(root) / '.github/workflows' / name).read_text())
            for name in [PARENT, *CHILDREN.values(), 'migrate-d1.yml', 'migrate-line-credentials.yml']}


def triggers(workflow):
    return workflow.get('on', workflow.get(True, {}))


def need(condition, code):
    if not condition:
        raise ValueError(code)


def runs(job):
    return [s.get('run', '') for s in job.get('steps', [])]


def ordered(job, commands):
    scripts = runs(job)
    indices = []
    for command in commands:
        found = [i for i, script in enumerate(scripts) if command in script]
        need(len(found) == 1, 'missing_or_duplicate_step:' + command)
        step = job['steps'][found[0]]
        need(not step.get('if') and not step.get('continue-on-error'), 'conditional_safety_step')
        indices.append(found[0])
    need(indices == sorted(set(indices)), 'unsafe_step_order')


def check(workflows):
    parent = workflows[PARENT]
    need(set(triggers(parent)) == {'workflow_dispatch'}, 'manual_parent_only')
    need(parent.get('concurrency') == {'group': 'cloudflare-production', 'cancel-in-progress': False}, 'whole_release_lock')
    need(set(parent['jobs']) == {'authorize', *CHILDREN}, 'release_topology')
    gate = parent['jobs']['authorize']
    need(gate.get('environment') == 'production', 'approval_environment')
    need("github.ref == 'refs/heads/main'" in gate.get('if', ''), 'main_guard')
    ordered(gate, ['production/run.ts preflight'])
    previous = 'authorize'
    for name, filename in CHILDREN.items():
        call = parent['jobs'][name]
        needs = call.get('needs', [])
        need(needs == previous or needs == [previous], 'release_dependency:' + name)
        need(call.get('uses') == './.github/workflows/' + filename, 'child_reference')
        need('if' not in call and not call.get('continue-on-error'), 'success_dependency')
        need(call.get('with', {}).get('release_sha') == '${{ inputs.release_sha }}', 'same_release_sha')
        need(call.get('with', {}).get('operations_paused') == '${{ inputs.operations_paused }}', 'operations_pause_confirmation')
        need(call.get('with', {}).get('staging_run_id') == '${{ inputs.staging_run_id }}', 'same_staging_run')
        child = workflows[filename]
        need(set(triggers(child)) == {'workflow_call'}, 'reusable_child_only:' + filename)
        need(len(child['jobs']) == 1, 'child_job_count')
        job = next(iter(child['jobs'].values()))
        need(job.get('environment') == 'production', 'child_approval_environment')
        need('deploy-cloudflare-production.yml@refs/heads/main' in job.get('if', '') and "github.ref == 'refs/heads/main'" in job.get('if', ''), 'parent_caller_guard')
        need('concurrency' not in job, 'child_parent_lock_deadlock')
        need(not job.get('continue-on-error'), 'child_failure_propagation')
        for step in job.get('steps', []):
            need(not step.get('continue-on-error'), 'step_failure_propagation')
            need('always()' not in step.get('if', ''), 'no_publish_after_failure')
            if step.get('uses', '').startswith('actions/checkout@'):
                need(step.get('with', {}).get('ref') == '${{ inputs.release_sha }}', 'checkout_sha')
            need(not step.get('uses', '').startswith('actions/upload-artifact@'), 'no_public_sql_artifacts')
        before_install = next((i for i, s in enumerate(job['steps']) if 'git merge-base --is-ancestor' in s.get('run', '')), None)
        install = next(i for i, s in enumerate(job['steps']) if 'pnpm install' in s.get('run', ''))
        need(before_install is not None and before_install < install, 'preinstall_source_guard')
        previous = name
    db = workflows[CHILDREN['database']]['jobs']['migrate']
    ordered(db, ['production/run.ts plan', 'production/run.ts backup', 'production/run.ts apply'])
    need(parent['jobs']['database']['with'].get('approved_migrations') == '${{ inputs.approved_migrations }}', 'sql_approval')
    worker = workflows[CHILDREN['worker']]['jobs']['deploy']
    ordered(worker, ['pnpm --filter worker build', 'production/run.ts worker-artifact', 'run-deployment-safety.ts production "apps/worker/$WORKER_DEPLOY_CONFIG"', 'production/run.ts deploy-worker', 'verify-public-build.mjs', 'production/run.ts worker-responses'])
    need(sum('production/run.ts no-pending' in script for script in runs(worker)) == 2, 'worker_db_read_only_gate')
    need(not any('apply-d1-migrations' in script or 'CREATE TABLE' in script or 'd1 execute' in script for script in runs(worker)), 'no_worker_migration')
    admin = workflows[CHILDREN['admin']]['jobs']['deploy']
    ordered(admin, ['pnpm --filter web build', 'production/run.ts admin-artifact', 'production/run.ts deploy-admin', 'production/run.ts pages', 'production/run.ts admin-responses'])
    manual = workflows['migrate-d1.yml']['jobs']['migrate']
    need("inputs.mode == 'dry-run'" in manual.get('if', '') and "inputs.environment == 'production'" in manual.get('if', ''), 'standalone_production_read_only')
    need('cloudflare-production' in manual.get('concurrency', {}).get('group', ''), 'standalone_production_lock')
    need('cloudflare-production' in workflows['migrate-line-credentials.yml'].get('concurrency', {}).get('group', ''), 'credential_migration_production_lock')


if __name__ == '__main__':
    try:
        check(load(Path(__file__).resolve().parents[2]))
    except (ValueError, KeyError, TypeError):
        print('production_workflow_structure: FAIL')
        sys.exit(1)
    print('production_workflow_structure: PASS')
