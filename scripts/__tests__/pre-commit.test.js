import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SDK_URL = 'https://artifactory-uw2.adobeitc.com/artifactory/api/npm/npm-assethub-sdk-release/@assethub/sdk/-/@assethub/sdk-0.1.0.tgz';

function runHook(workerLock, rootLock = { packages: {} }) {
  const temp = mkdtempSync(join(tmpdir(), 'assethub-registry-hook-'));
  try {
    mkdirSync(join(temp, '.husky'));
    mkdirSync(join(temp, 'cloudflare'));
    ['pre-commit', 'check-package-registries.mjs'].forEach((file) => {
      copyFileSync(new URL(`../../.husky/${file}`, import.meta.url), join(temp, '.husky', file));
    });
    writeFileSync(join(temp, 'package-lock.json'), JSON.stringify(rootLock));
    writeFileSync(join(temp, 'cloudflare/package-lock.json'), JSON.stringify(workerLock));
    return spawnSync('sh', ['.husky/pre-commit'], {
      cwd: temp,
      encoding: 'utf8',
      timeout: 5000,
    });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function sdkLock(resolved = SDK_URL) {
  return { packages: { 'node_modules/@assethub/sdk': { version: '0.1.0', resolved } } };
}

describe('pre-commit package registry policy', () => {
  it('allows public dependencies', () => {
    const result = runHook({
      packages: {
        'node_modules/jose': { resolved: 'https://registry.npmjs.org/jose/-/jose-6.0.13.tgz' },
      },
    });
    expect(result.status).toBe(0);
  });

  it('allows the approved SDK tarball', () => {
    expect(runHook(sdkLock()).status).toBe(0);
  });

  it('keeps unrelated Artifactory dependencies blocked', () => {
    const lock = sdkLock();
    lock.packages['node_modules/private-package'] = {
      resolved: 'https://artifactory-uw2.adobeitc.com/artifactory/api/npm/another-repository/private-package.tgz',
    };
    const result = runHook(lock);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('node_modules/private-package');
  });

  it('does not allow the SDK URL under a different package name', () => {
    const result = runHook({
      packages: { 'node_modules/another-package': { version: '0.1.0', resolved: SDK_URL } },
    });
    expect(result.status).toBe(1);
  });

  it.each([
    ['another repository', SDK_URL.replace('npm-assethub-sdk-release/', 'npm-another-release/')],
    ['another host', SDK_URL.replace('artifactory-uw2.adobeitc.com', 'artifactory.example.com')],
    ['a mismatched version', SDK_URL.replace('sdk-0.1.0.tgz', 'sdk-0.2.0.tgz')],
    ['an extra query', `${SDK_URL}?extra=true`],
  ])('rejects an SDK resolution with %s', (_label, url) => {
    expect(runHook(sdkLock(url)).status).toBe(1);
  });

  it('checks root lockfiles too', () => {
    const result = runHook(sdkLock(), {
      packages: {
        'node_modules/private-package': { resolved: 'https://artifactory.example.com/private-package.tgz' },
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('package-lock.json');
  });
});
