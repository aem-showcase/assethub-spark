/**
 * Unit tests for user.js sudo/simulation handling.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../util/helixutil.js', () => ({
  fetchHelixSheet: vi.fn(),
}));

const { fetchHelixSheet } = await import('../util/helixutil.js');
const { getUser, ROLE } = await import('../user.js');
const { PERMISSIONS } = await import('../../../scripts/auth/permissions.js');

function makeRequest(cookies) {
  return { cookies };
}

describe('getUser (sudo/simulation)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('strips the admin role from the simulated identity even when the email is unchanged', async () => {
    fetchHelixSheet.mockResolvedValue({
      'admin@example.com': { roles: ['admin'], countries: [] },
    });

    const session = {
      email: 'admin@example.com',
      domain: 'example.com',
      country: 'US',
      roles: ['admin'],
      permissions: [PERMISSIONS.SUDO],
    };
    const request = makeRequest({ SUDO_COUNTRY: 'italy' });

    const user = await getUser(request, {}, session);

    expect(user.country).toBe('italy');
    expect(user.roles).not.toContain(ROLE.ADMIN);
  });

  it('preserves the real roles under user.su for later restoration', async () => {
    fetchHelixSheet.mockResolvedValue({
      'admin@example.com': { roles: ['admin'], countries: [] },
    });

    const session = {
      email: 'admin@example.com',
      domain: 'example.com',
      country: 'US',
      roles: ['admin'],
      permissions: [PERMISSIONS.SUDO],
    };
    const request = makeRequest({ SUDO_COUNTRY: 'italy' });

    const user = await getUser(request, {}, session);

    expect(user.su.country).toBe('US');
    expect(user.su.roles).toContain(ROLE.ADMIN);
  });

  it('does not simulate anything when no SUDO_* cookies are set', async () => {
    const session = {
      email: 'admin@example.com',
      domain: 'example.com',
      country: 'US',
      roles: ['admin'],
      permissions: [PERMISSIONS.SUDO],
    };
    const request = makeRequest({});

    const user = await getUser(request, {}, session);

    expect(user.su).toBeUndefined();
    expect(user.roles).toContain(ROLE.ADMIN);
    expect(fetchHelixSheet).not.toHaveBeenCalled();
  });

  it('denies simulation for users without sudo permission', async () => {
    const session = {
      email: 'user@example.com',
      domain: 'example.com',
      country: 'US',
      roles: [],
      permissions: [],
    };
    const request = makeRequest({ SUDO_COUNTRY: 'italy' });

    const user = await getUser(request, {}, session);

    expect(user.country).toBe('US');
    expect(user.su).toBeUndefined();
  });
});
