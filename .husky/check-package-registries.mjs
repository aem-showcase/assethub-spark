import { existsSync, readFileSync } from 'node:fs';

const SDK_PATH = 'node_modules/@assethub/sdk';
const SDK_TARBALL_BASE = 'https://artifactory-uw2.adobeitc.com/artifactory/api/npm/npm-assethub-sdk-release/@assethub/sdk/-/@assethub/sdk-';
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function checkRegistry(value, keys, filename, sdkTarball) {
  if (typeof value === 'string' && value.toLowerCase().includes('artifactory')) {
    const isSdkResolution = keys.length === 3
      && keys[0] === 'packages'
      && keys[1] === SDK_PATH
      && keys[2] === 'resolved';
    if (isSdkResolution && value === sdkTarball) return;
    console.error(`Error: Unapproved Artifactory dependency in ${filename}: ${keys.join('.')}`);
    process.exitCode = 1;
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, child]) => {
      checkRegistry(child, [...keys, key], filename, sdkTarball);
    });
  }
}

process.argv.slice(2).filter(existsSync).forEach((filename) => {
  try {
    const lock = JSON.parse(readFileSync(filename, 'utf8'));
    const version = lock.packages?.[SDK_PATH]?.version;
    const sdkTarball = typeof version === 'string' && VERSION_PATTERN.test(version)
      ? `${SDK_TARBALL_BASE}${version}.tgz`
      : null;
    checkRegistry(lock, [], filename, sdkTarball);
  } catch {
    console.error(`Error: Could not validate package lock: ${filename}`);
    process.exitCode = 1;
  }
});
