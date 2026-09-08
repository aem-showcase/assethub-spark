import { describe, it, expect } from 'vitest';
import { companyBasePath, COMPANIES_CONTAINER } from '../../scripts/assets/constants.js';

describe('companyBasePath — foldered demo base under the companies container', () => {
  it('nests the company key under /companies', () => {
    expect(companyBasePath('workday')).toBe('/companies/workday');
    expect(companyBasePath('acme-demo')).toBe('/companies/acme-demo');
  });

  it('the container constant is "companies"', () => {
    expect(COMPANIES_CONTAINER).toBe('companies');
  });
});
