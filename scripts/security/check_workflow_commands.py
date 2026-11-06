"""Check literal source-script connections without executing workflow commands.

PyYAML is already installed by the required gate's YAML/shell syntax step.
This supplements that syntax check; it is not a general Bash interpreter.
Variable paths and package-manager scripts are verified by their build/test
steps, not inferred here. Literal script paths are checked even in skipped jobs.
"""

import re
import shlex
import sys
from pathlib import Path

import yaml


COMMAND = re.compile(
    r"^\s*(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)*"
    r"(?:(?:pnpm|npx)\s+(?:--silent\s+)?(?:exec\s+)?)?"
    r"(?:node|tsx|bash|sh|python3)\s+"
)
SOURCE_SCRIPT = re.compile(
    r"^(?:\./)?(?:apps|packages|scripts|sites)/[^$`]+\.(?:[mc]?js|ts|py|sh)$"
)


def missing_scripts(script, directory):
    """Inspect direct interpreter invocations, including Node test-file lists."""
    missing = []
    lines = iter(script.replace("\\\n", " ").splitlines())
    for line in lines:
        match = COMMAND.match(line)
        if not match:
            continue
        # Shell syntax is checked separately. shlex keeps quoted inline code and
        # comments from being mistaken for additional script arguments.
        arguments = line[match.end():]
        while True:
            try:
                tokens = shlex.split(arguments, comments=True)
                break
            except ValueError:
                # Inline node -e code can be quoted across several lines.
                following = next(lines, None)
                if following is None:
                    raise
                arguments += '\n' + following
        for token in tokens:
            if token in ('-e', '--eval', '-p', '--print', '-c'):
                break
            if SOURCE_SCRIPT.fullmatch(token):
                if not any(path.is_file() for path in directory.glob(token)):
                    missing.append(token)
                # Remaining arguments belong to the program. Only the test
                # runner (also browser-host --test) accepts more script files.
                if '--test' not in tokens:
                    break
    return missing


def inspect_workflow(document, root):
    failures = []
    workflow_directory = document.get('defaults', {}).get('run', {}).get('working-directory', '.')
    for job_id, job in (document.get('jobs') or {}).items():
        job_directory = job.get('defaults', {}).get('run', {}).get('working-directory', workflow_directory)
        for index, step in enumerate(job.get('steps') or [], 1):
            script = step.get('run')
            if not script:
                continue
            directory = step.get('working-directory', job_directory)
            if '${{' in directory or '$' in directory:
                continue
            script = re.sub(r'\$\{\{[^}]*\}\}', 'GH_EXPR', script)
            for path in missing_scripts(script, root / directory):
                failures.append(f"{job_id} / {step.get('name', index)}: missing source script {path}")
    return failures


def main(root):
    failures = []
    for workflow in sorted((root / '.github/workflows').glob('*.yml')):
        document = yaml.safe_load(workflow.read_text(encoding='utf-8'))
        failures.extend(f'{workflow.name}: {failure}' for failure in inspect_workflow(document, root))
    for failure in failures:
        print(f'[NG] {failure}')
    if not failures:
        print('[OK] workflow literal source-script connections')
    return int(bool(failures))


if __name__ == '__main__':
    sys.exit(main(Path(__file__).resolve().parents[2]))
