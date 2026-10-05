import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { initCartBackgroundJobs } from '../cart-utils.js';

vi.mock('../cart-utils.js', () => ({
  isItemInCart: vi.fn(),
  areAllItemsInCart: vi.fn(),
  removeItemsFromCart: vi.fn(),
  addItemsToCart: vi.fn(),
  initCartBackgroundJobs: vi.fn(),
  getCartJobsStatus: vi.fn(),
  registerCartButtonSync: vi.fn(),
}));

describe('cart-service initialization', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete document.prerendering;
  });

  it('initializes background jobs immediately on an active page', async () => {
    await import('../cart-service.js');

    expect(initCartBackgroundJobs).toHaveBeenCalledTimes(1);
  });

  it('waits for activation before initializing jobs on a prerendered page', async () => {
    Object.defineProperty(document, 'prerendering', {
      value: true,
      configurable: true,
    });

    await import('../cart-service.js');
    expect(initCartBackgroundJobs).not.toHaveBeenCalled();

    document.dispatchEvent(new Event('prerenderingchange'));
    document.dispatchEvent(new Event('prerenderingchange'));

    expect(initCartBackgroundJobs).toHaveBeenCalledTimes(1);
  });
});
