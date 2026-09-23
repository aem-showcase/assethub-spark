import {
  describe, it, expect, beforeAll,
} from 'vitest';
import { spawnSync, execFile } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cpus, tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const SKILL = join(here, '..', '..');
const REPO = join(SKILL, '..', '..', '..');
const HOOKS = join(SKILL, 'hooks');
const CORPUS = join(SKILL, 'tests', 'fixtures', 'guard-replay-corpus.json');

/**
 * Why this exists.
 *
 * On 2026-09-18 a single commit registered all six rebrand-portal guards with
 * Copilot CLI for the first time and taught them Copilot's tool-name dialect.
 * Both changes were correct. The combined effect was that six guards which had
 * never inspected a single Copilot command went live at once, and one of them --
 * guard-secret-read.sh -- matched "a secret filename appears" against "a dumping
 * tool appears" across the *whole* compound command rather than per step. Ten
 * harmless commands were blocked, including worktree secret seeding, Helix token
 * setup, and every DA read. The run lost ~35 minutes to retries.
 *
 * Nothing caught it because nothing had ever replayed a real command through the
 * guards. This suite does exactly that: every command in the corpus actually ran
 * during a real session (or was a proven false positive from the Disney run), so
 * a guard blocking any of them is a regression by definition.
 *
 * Re-harvest the corpus from ~/.copilot/session-state/<id>/events.jsonl when the
 * skill's command vocabulary changes materially.
 */

function guardScripts() {
  return readdirSync(HOOKS).filter((f) => f.endsWith('.sh')).sort();
}

function runGuard(script, command, toolName = 'bash') {
  const payload = JSON.stringify({ tool_name: toolName, tool_input: { command } });
  const result = spawnSync('bash', [join(HOOKS, script)], {
    input: payload,
    cwd: REPO,
    encoding: 'utf8',
    timeout: 15_000,
  });
  return {
    blocked: result.status !== 0,
    status: result.status,
    stderr: result.stderr || '',
    stdout: result.stdout || '',
  };
}

function firstBlocker(command, toolName = 'bash') {
  return guardScripts().find((s) => runGuard(s, command, toolName).blocked) || null;
}

// The corpus is ~90 commands against 6 guards, each a bash+python process.
// Run them through a small pool so the suite finishes in seconds rather than
// minutes; a slow guard test is a guard test people start skipping.
//
// The pool is deliberately small. Vitest already runs test files in parallel
// across roughly one worker per core, so a greedy pool here starves sibling
// suites and surfaces as unrelated 5s test timeouts elsewhere in the run.
const POOL = Math.max(2, Math.min(4, Math.floor((cpus().length || 4) / 4)));
//
// Only exit status 2 counts as a block. Anything else (spawn failure, timeout,
// a crashing guard) is surfaced as an error rather than silently reported as a
// denial -- misattributing an infrastructure failure to a guard is how the
// original incident was misdiagnosed in the first place.
function runGuardAsync(script, command, toolName) {
  return new Promise((resolve, reject) => {
    const child = execFile('bash', [join(HOOKS, script)], {
      cwd: REPO, encoding: 'utf8', timeout: 30_000,
    }, (error) => {
      if (!error) {
        resolve(false);
        return;
      }
      if (error.code === 2) {
        resolve(true);
        return;
      }
      reject(new Error(`${script} exited with ${error.code ?? error.signal}: ${error.message}`));
    });
    child.stdin.end(JSON.stringify({ tool_name: toolName, tool_input: { command } }));
  });
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

const corpus = JSON.parse(readFileSync(CORPUS, 'utf8'));

describe('guard replay corpus', () => {
  it('the corpus is populated and still contains the Disney-run regressions', () => {
    expect(corpus.length).toBeGreaterThan(50);
    const disney = corpus.filter((c) => c.origin === 'disney-run-2026-09-18');
    expect(
      disney.length,
      'the commands this corpus exists to protect have been dropped',
    ).toBeGreaterThanOrEqual(9);
  });

  // Every host dialect, because the original bug was that the guards saw
  // Copilot's lowercase tool name and silently did nothing.
  for (const toolName of ['bash', 'Bash']) {
    it(`no guard blocks a known-good command (tool_name: ${toolName})`, async () => {
      const tasks = corpus.flatMap(
        (entry) => guardScripts().map((script) => ({ entry, script })),
      );
      const outcomes = await mapPool(
        tasks, POOL, ({ entry, script }) => runGuardAsync(script, entry.command, toolName),
      );

      const blocked = tasks
        .map((task, index) => ({ ...task, blocked: outcomes[index] }))
        .filter((r) => r.blocked);

      const detail = blocked
        .map((r) => `  ${r.script} blocked: ${r.entry.description || r.entry.command.slice(0, 80)}`)
        .join('\n');

      expect(blocked.length, `guards blocked known-good commands:\n${detail}`).toBe(0);
    }, 180_000);
  }
});

describe('secret-read guard still catches real leaks', () => {
  // Assembled at runtime so this test file does not itself contain a literal
  // string that the guards would flag.
  const SECRET = `token${'.'}env`;
  const CAT = `c${'at'}`;
  const GREP = `gr${'ep'}`;

  const leaks = [
    ['dumps the secret outright', `${CAT} ${SECRET}`],
    ['dumps it after unrelated work', `curl -s https://x/y > /tmp/a && ${CAT} ${SECRET}`],
    ['prints the matching line', `${GREP} DA_TOKEN ${SECRET}`],
    ['supplies the pattern with -e', `${GREP} -e DA_TOKEN ${SECRET}`],
    ['tails the secret', `ta${'il'} -5 ${SECRET}`],
    ['redact-and-inspect', `${CAT} ${SECRET} | se${'d'} 's/=.*/=X/'`],
    ['base64 encodes it', `base${'64'} ${SECRET}`],
    ['command substitution', `echo $(${CAT} ${SECRET})`],
    ['pipes the secret into grep', `${CAT} ${SECRET} | ${GREP} DA`],
  ];

  for (const [name, command] of leaks) {
    it(`blocks: ${name}`, () => {
      expect(firstBlocker(command)).toBe('guard-secret-read.sh');
    });
  }

  const safe = [
    ['sources the secret, prints a downloaded page',
      `. ./${SECRET} && curl -s https://x > /tmp/p.html && ${CAT} /tmp/p.html`],
    ['counts the key without printing it', `${GREP} -c '^DA_TOKEN=' ${SECRET}`],
    ['searches for the filename in another file', `${GREP} -n "${SECRET}" .gitignore`],
    ['copies the secret into a worktree',
      `cp ${SECRET} .worktrees/demo/${SECRET} && mkdir -p .worktrees/demo/x`],
    ['checks the file size', `wc -c ${SECRET}`],
  ];

  for (const [name, command] of safe) {
    it(`allows: ${name}`, () => {
      expect(firstBlocker(command)).toBeNull();
    });
  }
});

describe('denial reporting', () => {
  const SECRET = `token${'.'}env`;
  const leak = `c${'at'} ${SECRET}`;

  it('names the guard and the supported alternative on stderr', () => {
    const { stderr } = runGuard('guard-secret-read.sh', leak);
    expect(stderr).toContain('secret-read');
    expect(stderr).toContain('Do this instead');
  });

  it('emits a Copilot permissionDecision on stdout, which is the only channel Copilot surfaces', () => {
    const { stdout } = runGuard('guard-secret-read.sh', leak);
    const decision = JSON.parse(stdout);
    expect(decision.permissionDecision).toBe('deny');
    expect(decision.permissionDecisionReason).toContain('secret-read');
  });
});

describe('watch-only mode', () => {
  const SECRET = `token${'.'}env`;
  const leak = `c${'at'} ${SECRET}`;
  let watched;
  let logPath;

  beforeAll(() => {
    // A temp dir, not the repo: a test that leaves an untracked artifact behind
    // trains people to ignore `git status`.
    logPath = join(mkdtempSync(join(tmpdir(), 'guard-watch-')), 'guard-watch.log');
    watched = spawnSync('bash', [join(HOOKS, 'guard-secret-read.sh')], {
      input: JSON.stringify({ tool_name: 'bash', tool_input: { command: leak } }),
      cwd: REPO,
      encoding: 'utf8',
      timeout: 15_000,
      env: {
        ...process.env,
        REBRAND_GUARDS_WATCH_ONLY: '1',
        REBRAND_GUARDS_WATCH_LOG: logPath,
      },
    });
  });

  it('allows the command it would otherwise block', () => {
    expect(watched.status).toBe(0);
  });

  it('still reports what it would have blocked', () => {
    expect(watched.stderr).toContain('[watch-only]');
    expect(watched.stderr).toContain('secret-read');
  });

  it('records the would-be block to the log, which is what you read before enforcing', () => {
    expect(existsSync(logPath)).toBe(true);
    expect(readFileSync(logPath, 'utf8')).toContain('secret-read');
  });
});

describe('guards are host-dialect aware', () => {
  const SECRET = `token${'.'}env`;
  const leak = `c${'at'} ${SECRET}`;

  // The original defect: Copilot sends toolName/toolArgs and a lowercase tool
  // name, so guards matching only Claude's dialect were inert on Copilot.
  const dialects = [
    ['claude code', { tool_name: 'Bash', tool_input: { command: leak } }],
    ['copilot cli', { toolName: 'bash', toolArgs: { command: leak } }],
  ];

  for (const [name, payload] of dialects) {
    it(`blocks a real leak in the ${name} dialect`, () => {
      const result = spawnSync('bash', [join(HOOKS, 'guard-secret-read.sh')], {
        input: JSON.stringify(payload),
        cwd: REPO,
        encoding: 'utf8',
        timeout: 15_000,
      });
      expect(result.status).toBe(2);
    });
  }
});
