#!/usr/bin/env node
//
// Claude Code WorktreeRemove hook — companion to worktree-create.js.
//
// WHY THIS EXISTS: when a worktree was created by a custom WorktreeCreate hook,
// Claude Code marks it "hookBased" and on exit DOES NOT run its own
// `git worktree remove` or branch deletion — it delegates cleanup entirely to a
// WorktreeRemove hook. Without this hook, exiting leaves the worktree AND its
// branch behind. So this hook reproduces Claude's built-in default cleanup:
// force-remove the worktree and delete its branch. (Claude's upstream exit flow
// already handles the "discard uncommitted changes?" prompt before calling us.)
//
// Delete this together with worktree-create.js (and the hooks entries in
// .claude/settings.json) if Claude ever makes the branch prefix configurable —
// then worktrees are no longer hookBased and Claude cleans them up itself.
//
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Stdin: { session_id, transcript_path, cwd, hook_event_name, worktree_path }.
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const worktreePath = input.worktree_path;

// Already gone? Nothing to do (exit 0 = success).
if (!worktreePath || !fs.existsSync(worktreePath)) process.exit(0);

const capture = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

// Resolve the main checkout (where the shared .git dir lives) and the branch.
const gitCommonDir = capture(worktreePath, 'rev-parse', '--path-format=absolute', '--git-common-dir');
// Parent of the shared git dir = main checkout root (more robust than matching `.git`).
const mainRoot = path.dirname(gitCommonDir.replace(/\/$/, ''));
let branch = '';
try {
  branch = capture(worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD');
} catch {
  /* detached or unreadable — leave branch empty */
}

// Remove the worktree. --force matches Claude's default cleanup; the upstream
// exit flow has already confirmed any discard of uncommitted work.
execFileSync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: mainRoot, stdio: ['ignore', 2, 2] });

// Delete its branch, mirroring Claude's default. Never touch main/HEAD.
if (branch && branch !== 'HEAD' && branch !== 'main' && branch !== 'master') {
  try {
    execFileSync('git', ['branch', '-D', branch], { cwd: mainRoot, stdio: ['ignore', 2, 2] });
  } catch {
    /* e.g. branch checked out elsewhere — leave it rather than fail removal */
  }
}
