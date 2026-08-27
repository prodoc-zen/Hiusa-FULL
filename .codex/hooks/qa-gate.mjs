import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const MAX_OUTPUT_CHARS = 6000;
const CHECK_TIMEOUT_MS = 120_000;

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function run(executable, args, options = {}) {
  const command = [executable, ...args].join(' ');
  const usesWindowsCommandShim = process.platform === 'win32' && executable.endsWith('.cmd');
  const invokedExecutable = usesWindowsCommandShim ? (process.env.ComSpec || 'cmd.exe') : executable;
  const invokedArgs = usesWindowsCommandShim ? ['/d', '/s', '/c', command] : args;
  const result = spawnSync(invokedExecutable, invokedArgs, {
    cwd: options.cwd,
    encoding: 'utf8',
    timeout: options.timeout ?? CHECK_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, ...options.env },
  });

  return {
    command,
    status: result.status,
    error: result.error,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  };
}

function gitLines(root, args) {
  const result = run('git', args, { cwd: root, timeout: 15_000 });
  if (result.error || result.status !== 0) {
    throw new Error(result.output || result.error?.message || `git ${args.join(' ')} failed`);
  }

  return result.output
    .split(/\r?\n/)
    .map((file) => file.trim().replaceAll('\\', '/'))
    .filter(Boolean);
}

function changedFiles(root, event) {
  if (process.env.HIUSA_QA_GATE_TEST === '1' && Array.isArray(event.test_changed_files)) {
    return [...new Set(event.test_changed_files.map((file) => String(file).replaceAll('\\', '/')))];
  }

  return [...new Set([
    ...gitLines(root, ['diff', '--name-only']),
    ...gitLines(root, ['diff', '--name-only', '--cached']),
    ...gitLines(root, ['ls-files', '--others', '--exclude-standard']),
  ])];
}

function findRepositoryRoot() {
  const result = run('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd(), timeout: 15_000 });
  if (result.error || result.status !== 0) {
    throw new Error(result.output || result.error?.message || 'Unable to locate the Git repository root.');
  }

  return result.output.trim();
}

function pythonExecutable(root) {
  const windowsVenv = join(root, 'ai-service', '.venv', 'Scripts', 'python.exe');
  const posixVenv = join(root, 'ai-service', '.venv', 'bin', 'python');

  if (existsSync(windowsVenv)) return windowsVenv;
  if (existsSync(posixVenv)) return posixVenv;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function addCheck(checks, name, executable, args, cwd) {
  checks.push({ name, executable, args, cwd });
}

function planChecks(root, files) {
  const checks = [];
  const clientRoot = join(root, 'client');
  const serverRoot = join(root, 'server');
  const aiRoot = join(root, 'ai-service');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  const clientCode = files.some((file) =>
    /^client\/(src\/|package(?:-lock)?\.json$|vite\.config\.|vitest\.config\.)/.test(file));
  const clientJs = files.some((file) =>
    /^client\/(src\/.*\.[cm]?[jt]sx?$|e2e\/.*\.[cm]?[jt]s$|.*config\.[cm]?js$)/.test(file));
  const e2eConfig = files.some((file) =>
    /^client\/(e2e\/|playwright\.config\.|package(?:-lock)?\.json$)/.test(file));

  if (clientCode) {
    addCheck(checks, 'Frontend unit tests', npm, ['run', 'test:unit'], clientRoot);
    addCheck(checks, 'Frontend production build', npm, ['run', 'build'], clientRoot);
  }
  if (clientJs) {
    addCheck(checks, 'Frontend lint', npm, ['run', 'lint'], clientRoot);
  }
  if (e2eConfig) {
    addCheck(checks, 'Playwright test discovery', npm, ['run', 'test:e2e', '--', '--list'], clientRoot);
  }

  const backendProduction = files.some((file) =>
    /^server\/(app\/|bootstrap\/|config\/|database\/|routes\/|composer\.(?:json|lock)$|phpunit\.xml$)/.test(file));
  const backendTests = files.filter((file) => /^server\/tests\/.*\.php$/.test(file));

  if (backendProduction) {
    addCheck(checks, 'Laravel tests', 'php', ['artisan', 'test', '--stop-on-failure'], serverRoot);
  } else if (backendTests.length > 0) {
    const relativeTests = backendTests.map((file) => relative(serverRoot, join(root, file)).replaceAll('\\', '/'));
    addCheck(checks, 'Targeted Laravel tests', 'php', ['artisan', 'test', ...relativeTests, '--stop-on-failure'], serverRoot);
  }

  const aiChanged = files.some((file) =>
    /^ai-service\/(app\/|tests\/|pytest\.ini$|requirements(?:-dev)?\.txt$)/.test(file));
  if (aiChanged) {
    addCheck(checks, 'FastAPI tests', pythonExecutable(root), ['-m', 'pytest'], aiRoot);
  }

  return checks;
}

function failurePayload(event, failure) {
  const details = [
    `QA gate failed: ${failure.name}`,
    `Command: ${failure.command}`,
    failure.error ? `Runner error: ${failure.error.message}` : null,
    failure.output ? `Output:\n${failure.output.slice(-MAX_OUTPUT_CHARS)}` : 'No command output was captured.',
  ].filter(Boolean).join('\n');

  if (event.stop_hook_active) {
    return {
      continue: false,
      stopReason: 'HIUSA QA gate still fails after the one allowed automatic repair continuation.',
      systemMessage: details,
    };
  }

  return {
    decision: 'block',
    reason: `${details}\nFix only the relevant failure, rerun the focused check, and retry completion once.`,
  };
}

let event;
try {
  const input = readFileSync(0, 'utf8').trim();
  event = input ? JSON.parse(input) : {};
} catch (error) {
  emit({
    continue: false,
    stopReason: 'HIUSA QA gate received invalid Stop-hook JSON.',
    systemMessage: error.message,
  });
  process.exit(0);
}

try {
  const root = findRepositoryRoot();
  const files = changedFiles(root, event);
  const checks = planChecks(root, files);

  for (const check of checks) {
    const result = run(check.executable, check.args, { cwd: check.cwd });
    if (result.error || result.status !== 0) {
      emit(failurePayload(event, { ...check, ...result }));
      process.exit(0);
    }
  }

  emit({});
} catch (error) {
  emit(failurePayload(event, {
    name: 'QA gate infrastructure',
    command: 'repository discovery and check planning',
    error,
    output: '',
  }));
}
