import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readToken, readVarFallback, readBaseSlug,
} from '../../scripts/rebrand/capture-base.mjs';

// A minimal :root block mirroring the base template's shape (frescopa at time of writing).
const ROOT_CSS = `
:root {
  --light-color: #F4E9DC;
  --primary-color: #00647D;
  --primary-color-hover: #004d61;
  --secondary-color: #95351D;
  --text-color: #58181D;
  --nav-height: 72px;
}
body:has(.section.welcome) {
  background-color: var(--welcome-panel-bg, #2f2318);
}
main::before {
  background-image: radial-gradient(ellipse 80% 55% at 15% 110%, rgb(var(--welcome-panel-accent-rgb, 234 163 58) / 22%) 0%, transparent 100%);
}
`;

describe('capture-base reader helpers', () => {
  describe('readToken', () => {
    it('reads the base surface and brand tokens from :root', () => {
      // Self-test: on the base template these ARE the frescopa values. This fixture asserts
      // the parser, not a forever-target — the live script reads whatever the tree holds.
      expect(readToken(ROOT_CSS, 'light-color')).toBe('#F4E9DC');
      expect(readToken(ROOT_CSS, 'primary-color')).toBe('#00647D');
      expect(readToken(ROOT_CSS, 'secondary-color')).toBe('#95351D');
      expect(readToken(ROOT_CSS, 'nav-height')).toBe('72px');
    });

    it('returns null for an absent token', () => {
      expect(readToken(ROOT_CSS, 'no-such-token')).toBeNull();
    });
  });

  describe('readVarFallback', () => {
    it('reads a var(--x, <fallback>) literal', () => {
      expect(readVarFallback(ROOT_CSS, 'welcome-panel-bg')).toBe('#2f2318');
      expect(readVarFallback(ROOT_CSS, 'welcome-panel-accent-rgb')).toBe('234 163 58');
    });

    it('returns null when the var has no fallback / is absent', () => {
      expect(readVarFallback(ROOT_CSS, 'no-var')).toBeNull();
    });
  });

  describe('readBaseSlug', () => {
    it('derives the slug from a <slug>-beans.svg mark (not a generic UI icon)', () => {
      const dir = mkdtempSync(join(tmpdir(), 'caps-icons-'));
      try {
        // generic UI icons that also match *-icon.svg must NOT win
        writeFileSync(join(dir, 'copy-icon.svg'), '<svg/>');
        writeFileSync(join(dir, 'delete-icon.svg'), '<svg/>');
        // brand marks
        writeFileSync(join(dir, 'frescopa-icon.svg'), '<svg/>');
        writeFileSync(join(dir, 'frescopa-beans.svg'), '<svg/>');
        expect(readBaseSlug(dir)).toBe('frescopa');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('falls back to <slug>_logo.svg when no -beans mark exists', () => {
      const dir = mkdtempSync(join(tmpdir(), 'caps-icons2-'));
      try {
        writeFileSync(join(dir, 'acme_logo.svg'), '<svg/>');
        expect(readBaseSlug(dir)).toBe('acme');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('returns null when the icons dir is missing', () => {
      expect(readBaseSlug(join(tmpdir(), 'does-not-exist-xyz'))).toBeNull();
    });
  });

  describe('CLI writes a baseBrand block to state', () => {
    it('captures slug + surface + oldHexes and bumps schema to 5', async () => {
      const root = mkdtempSync(join(tmpdir(), 'caps-root-'));
      try {
        mkdirSync(join(root, 'styles'), { recursive: true });
        mkdirSync(join(root, 'icons'), { recursive: true });
        mkdirSync(join(root, '.internal'), { recursive: true });
        writeFileSync(join(root, 'styles', 'styles.css'), ROOT_CSS);
        writeFileSync(join(root, 'icons', 'frescopa-beans.svg'), '<svg/>');
        writeFileSync(join(root, 'icons', 'frescopa-icon.svg'), '<svg/>');
        writeFileSync(
          join(root, '.internal', 'onboarding-state.json'),
          JSON.stringify({ schemaVersion: 4, customer: {}, steps: {} }),
        );
        const { execFileSync } = await import('node:child_process');
        const script = new URL('../../scripts/rebrand/capture-base.mjs', import.meta.url).pathname;
        execFileSync('node', [script, '--repo-root', root], { stdio: 'pipe' });
        const state = JSON.parse(
          (await import('node:fs')).readFileSync(join(root, '.internal', 'onboarding-state.json'), 'utf8'),
        );
        expect(state.schemaVersion).toBe(5);
        expect(state.baseBrand.baseSlug).toBe('frescopa');
        expect(state.baseBrand.baseSurfaceHex).toBe('#F4E9DC');
        expect(state.baseBrand.oldHexes).toContain('#00647D');
        // neutral greys are NOT captured (only named brand tokens feed oldHexes)
        expect(state.baseBrand.oldHexes).not.toContain('#FFF');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('captures allBaseHexes repo-wide, including a one-off literal outside styles.css :root', async () => {
      const root = mkdtempSync(join(tmpdir(), 'caps-root2-'));
      try {
        mkdirSync(join(root, 'styles'), { recursive: true });
        mkdirSync(join(root, 'icons'), { recursive: true });
        mkdirSync(join(root, 'blocks', 'search-results', 'styles'), { recursive: true });
        mkdirSync(join(root, '.internal'), { recursive: true });
        writeFileSync(join(root, 'styles', 'styles.css'), ROOT_CSS);
        writeFileSync(join(root, 'icons', 'frescopa-beans.svg'), '<svg/>');
        writeFileSync(join(root, 'icons', 'frescopa-icon.svg'), '<svg/>');
        // A one-off literal in block-level CSS, not one of the 11 named tokens —
        // exactly the class of value oldHexes never sees but allBaseHexes must.
        writeFileSync(
          join(root, 'blocks', 'search-results', 'styles', 'theme.css'),
          '.pressed { background-color: #003d4d; }',
        );
        writeFileSync(
          join(root, '.internal', 'onboarding-state.json'),
          JSON.stringify({ schemaVersion: 4, customer: {}, steps: {} }),
        );
        const { execFileSync } = await import('node:child_process');
        const script = new URL('../../scripts/rebrand/capture-base.mjs', import.meta.url).pathname;
        execFileSync('node', [script, '--repo-root', root], { stdio: 'pipe' });
        const state = JSON.parse(
          (await import('node:fs')).readFileSync(join(root, '.internal', 'onboarding-state.json'), 'utf8'),
        );
        expect(state.baseBrand.oldHexes).not.toContain('#003D4D');
        const hit = state.baseBrand.allBaseHexes.find((e) => e.hex === '#003D4D');
        expect(hit).toBeDefined();
        expect(hit.file).toBe(join('blocks', 'search-results', 'styles', 'theme.css'));
        expect(hit.selector).toBe('.pressed');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });
});
