#!/usr/bin/env node
//
// Claude Code WorktreeCreate hook.
//
// WHY THIS EXISTS: the ONLY reason is to change the branch name — Claude Code's
// built-in `claude -w foo` hardcodes the branch as `worktree-foo`, and we want a
// clean `foo` instead. There is currently no setting to change that prefix, and a
// WorktreeCreate hook is the only supported way to override it.
// See https://github.com/anthropics/claude-code/issues/67384
//
// This script otherwise reproduces standard `claude -w` behavior 1:1: create the
// worktree at the given dir off the given base ref, and copy in the secret/config
// files each worktree needs its own independent copy of (rebrand-portal I9).
//
// Note: `git worktree add` also fires .husky/post-checkout, which does the same
// secrets copy for worktrees created outside Claude. Both are idempotent and run
// strictly one after the other (git runs the husky hook before it returns).
//
// If Claude Code ever makes the branch prefix configurable, DELETE this script and
// the WorktreeCreate entry in .claude/settings.json and use that setting instead.
//
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Stdin gives us: { session_id, transcript_path, cwd, hook_event_name, name }.
// It does NOT provide the worktree path or a base ref — we derive both, matching
// the locations/behavior of the built-in `claude -w`.
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const { cwd, name } = input;
const worktreeDir = path.join(cwd, '.claude', 'worktrees', name);
const branch = name; // the whole point: clean name, no `worktree-` prefix
const baseBranch = 'HEAD'; // branch off the current checkout (cf. worktree.baseRef: "head")

// Run git with its output on our stderr so stdout stays clean (only the path).
const git = (...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 2, 2] });
const branchExists = (b) => {
  try {
    execFileSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${b}`], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
// Like fs.existsSync, but does not follow symlinks (a dangling link still counts).
const pathExists = (p) => {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

if (!pathExists(worktreeDir)) {
  fs.mkdirSync(path.dirname(worktreeDir), { recursive: true });
  if (branchExists(branch)) {
    git('worktree', 'add', worktreeDir, branch); // reuse existing branch
  } else {
    git('worktree', 'add', '-b', branch, worktreeDir, baseBranch);
  }
}

// Copy secret/config files as REAL files, never symlink — each worktree must
// own independent secrets so parallel demos never share or clobber a token
// (rebrand-portal I9). Symlinking re-shares one token across worktrees.
const SECRET_FILES = ['cloudflare/.secrets', 'token.env'];
SECRET_FILES.forEach((rel) => {
  const src = path.join(cwd, rel);
  const dst = path.join(worktreeDir, rel);
  if (fs.existsSync(src) && !pathExists(dst)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
});

process.stdout.write(`${worktreeDir}\n`); // required: absolute worktree path on stdout
