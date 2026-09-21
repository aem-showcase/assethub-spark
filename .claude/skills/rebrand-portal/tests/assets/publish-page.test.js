import {
  describe, it, expect, vi,
} from 'vitest';
import {
  normalizeDaPath, sourceUrl, adminUrl, pullPage, pushPage, publishStage, main,
} from '../../scripts/assets/publish-page.js';

function okRes(body = '', status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  };
}

const BASE = { org: 'aem-showcase', repo: 'assethub-spark', path: 'companies/acme/en/index' };

describe('publish-page url building', () => {
  it('strips a leading slash and a .html suffix from the DA path', () => {
    expect(normalizeDaPath('/companies/acme/en/index.html')).toBe('companies/acme/en/index');
    expect(normalizeDaPath('companies/acme/en/index')).toBe('companies/acme/en/index');
  });

  it('builds the DA source URL with the .html the source API expects', () => {
    expect(sourceUrl(BASE))
      .toBe('https://admin.da.live/source/aem-showcase/assethub-spark/companies/acme/en/index.html');
  });

  it('builds admin URLs that carry the branch and no extension', () => {
    expect(adminUrl({ ...BASE, stage: 'live' }))
      .toBe('https://admin.hlx.page/live/aem-showcase/assethub-spark/main/companies/acme/en/index');
    expect(adminUrl({ ...BASE, stage: 'preview', branch: 'demo' }))
      .toBe('https://admin.hlx.page/preview/aem-showcase/assethub-spark/demo/companies/acme/en/index');
  });
});

describe('publish-page transport', () => {
  it('pullPage returns the body and sends the bearer token', async () => {
    const fetchFn = vi.fn(async () => okRes('<html>hi</html>'));
    const html = await pullPage({ ...BASE, daToken: 't0ken', fetchFn });
    expect(html).toBe('<html>hi</html>');
    const [, init] = fetchFn.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer t0ken');
  });

  it('pullPage throws with the status on a non-2xx', async () => {
    const fetchFn = vi.fn(async () => okRes('nope', 404));
    await expect(pullPage({ ...BASE, daToken: 't', fetchFn })).rejects.toThrow(/404/);
  });

  it('pushPage PUTs multipart form data', async () => {
    const fetchFn = vi.fn(async () => okRes());
    await pushPage({ ...BASE, html: '<html>x</html>', daToken: 't', fetchFn });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toContain('/source/aem-showcase/assethub-spark/companies/acme/en/index.html');
    expect(init.method).toBe('PUT');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('publishStage retries with x-content-source-authorization when the bearer is rejected', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(okRes('denied', 401))
      .mockResolvedValueOnce(okRes('', 200));
    const out = await publishStage({ ...BASE, stage: 'live', daToken: 't', fetchFn });
    expect(out.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[1][1].headers['x-content-source-authorization']).toBe('Bearer t');
  });

  it('publishStage throws when both auth shapes fail', async () => {
    const fetchFn = vi.fn(async () => okRes('bad', 403));
    await expect(publishStage({ ...BASE, stage: 'live', daToken: 't', fetchFn }))
      .rejects.toThrow(/403/);
  });
});

describe('publish-page CLI', () => {
  const io = (over = {}) => ({
    daToken: 'tok',
    log: { info: vi.fn() },
    readFile: vi.fn(() => '<html>local</html>'),
    writeFile: vi.fn(),
    fetchFn: vi.fn(async () => okRes('<html>remote</html>')),
    ...over,
  });

  it('requires --path', async () => {
    await expect(main([], io())).rejects.toThrow(/--path/);
  });

  it('refuses a no-op invocation', async () => {
    await expect(main(['--path', 'companies/acme/en/index'], io())).rejects.toThrow(/nothing to do/);
  });

  it('--pull writes the fetched HTML to disk', async () => {
    const deps = io();
    await main(['--path', 'companies/acme/en/index', '--pull', '/tmp/i.html'], deps);
    expect(deps.writeFile).toHaveBeenCalledWith('/tmp/i.html', '<html>remote</html>');
  });

  it('--push uploads the local file', async () => {
    const deps = io();
    await main(['--path', 'companies/acme/en/index', '--push', '/tmp/i.html'], deps);
    expect(deps.readFile).toHaveBeenCalledWith('/tmp/i.html');
    expect(deps.fetchFn.mock.calls[0][1].method).toBe('PUT');
  });

  it('--publish posts preview BEFORE live (the ceiling check reads the previewed page)', async () => {
    const deps = io();
    const res = await main(['--path', 'companies/acme/en/index', '--publish'], deps);
    expect(res.stages.map((s) => s.stage)).toEqual(['preview', 'live']);
    expect(deps.fetchFn.mock.calls[0][0]).toContain('/preview/');
    expect(deps.fetchFn.mock.calls[1][0]).toContain('/live/');
  });

  it('--preview-only stops before live', async () => {
    const deps = io();
    const res = await main(['--path', 'companies/acme/en/index', '--preview-only'], deps);
    expect(res.stages.map((s) => s.stage)).toEqual(['preview']);
    expect(deps.fetchFn.mock.calls.every(([u]) => !u.includes('/live/'))).toBe(true);
  });

  it('--dry-run performs no network call and no write', async () => {
    const deps = io();
    await main([
      '--path', 'companies/acme/en/index', '--pull', '/tmp/i.html', '--publish', '--dry-run',
    ], deps);
    expect(deps.fetchFn).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
  });

  it('honours --org/--repo/--branch overrides', async () => {
    const deps = io();
    await main([
      '--path', 'companies/acme/en/index',
      '--org', 'other-org', '--repo', 'other-repo', '--branch', 'demo', '--publish',
    ], deps);
    expect(deps.fetchFn.mock.calls[0][0])
      .toBe('https://admin.hlx.page/preview/other-org/other-repo/demo/companies/acme/en/index');
  });

  it('does not author content — no card/report flags are accepted', async () => {
    const deps = io();
    // A --report-file is silently irrelevant here by design: authoring lives in
    // update-index-cards.js. Passing it must not cause this script to rewrite anything.
    await main([
      '--path', 'companies/acme/en/index', '--push', '/tmp/i.html', '--report-file', 'r.json',
    ], deps);
    expect(deps.readFile).toHaveBeenCalledTimes(1);
    expect(deps.readFile).toHaveBeenCalledWith('/tmp/i.html');
  });
});
