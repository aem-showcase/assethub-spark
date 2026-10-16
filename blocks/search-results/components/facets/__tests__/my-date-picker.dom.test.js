import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

vi.mock('../../../../../scripts/locale-utils.js', () => ({
  getAppLabel: async () => (_key, fallback) => fallback,
}));

const { createDatePicker } = await import('../my-date-picker.js');

function stubAnchorSupport(supported) {
  window.CSS = {
    ...(window.CSS || {}),
    supports: vi.fn((prop) => (prop === 'anchor-name' ? supported : false)),
  };
}

async function openPicker() {
  const picker = await createDatePicker({ value: new Date(2026, 0, 15), onChange: vi.fn() });
  document.body.appendChild(picker);
  picker.querySelector('.dropdown-button').click();
  return picker;
}

describe('my-date-picker popup positioning', () => {
  const originalCSS = window.CSS;

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.spyOn(window, 'addEventListener');
  });

  afterEach(() => {
    window.CSS = originalCSS;
    vi.restoreAllMocks();
  });

  it('anchors the popup to the input with CSS and skips the scroll listener', async () => {
    stubAnchorSupport(true);
    const picker = await openPicker();

    const popup = document.querySelector('.my-date-picker-portal');
    const inputGroup = picker.querySelector('.date-input-group');
    expect(popup).not.toBeNull();
    expect(popup.classList.contains('is-anchored')).toBe(true);
    const anchor = inputGroup.style.getPropertyValue('anchor-name');
    expect(anchor).toMatch(/^--date-picker-\d+$/);
    expect(popup.style.getPropertyValue('position-anchor')).toBe(anchor);
    expect(popup.style.top).toBe('');
    expect(window.addEventListener).not.toHaveBeenCalledWith('scroll', expect.any(Function), true);
  });

  it('gives each picker its own anchor name', async () => {
    stubAnchorSupport(true);
    const first = await openPicker();
    const second = await openPicker();
    expect(first.querySelector('.date-input-group').style.getPropertyValue('anchor-name'))
      .not.toBe(second.querySelector('.date-input-group').style.getPropertyValue('anchor-name'));
  });

  it('falls back to measured position and a scroll listener without anchor support', async () => {
    stubAnchorSupport(false);
    await openPicker();

    const popup = document.querySelector('.my-date-picker-portal');
    expect(popup.classList.contains('is-anchored')).toBe(false);
    expect(popup.style.position).toBe('fixed');
    expect(popup.style.top).toMatch(/px$/);
    expect(window.addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function), true);
  });
});
