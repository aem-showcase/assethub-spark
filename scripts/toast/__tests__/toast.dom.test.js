import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import showToast from '../toast.js';

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('showToast', () => {
  it('renders an accessible status with an optional action', () => {
    vi.useFakeTimers();
    const toast = showToast('Saved', 'success', {
      actionLabel: 'Open collection',
      actionHref: '/collection-details?id=1',
    });

    expect(toast.getAttribute('role')).toBe('status');
    expect(toast.querySelector('.toast-message').textContent).toBe('Saved');
    expect(toast.querySelector('.toast-action').getAttribute('href'))
      .toBe('/collection-details?id=1');
  });

  it('uses assertive alert semantics for errors', () => {
    vi.useFakeTimers();
    const toast = showToast('Failed', 'error');
    expect(toast.getAttribute('role')).toBe('alert');
    expect(toast.getAttribute('aria-live')).toBe('assertive');
  });
});
