import {
  describe, it, expect, vi, beforeAll, beforeEach, afterEach,
} from 'vitest';

function fakeTransition() {
  let finish;
  const finished = new Promise((resolve) => { finish = resolve; });
  return {
    types: new Set(),
    skipTransition: vi.fn(),
    finished,
    finish,
  };
}

function dispatch(type, props) {
  const event = new Event(type);
  Object.entries(props).forEach(([key, value]) => {
    Object.defineProperty(event, key, { value });
  });
  window.dispatchEvent(event);
}

function name(selector) {
  return document.querySelector(selector)?.style.viewTransitionName || '';
}

const { origin } = window.location;

function renderHome() {
  document.body.className = 'appear';
  document.body.innerHTML = `
    <header></header>
    <main>
      <div class="section" data-section-status="loaded">
        <div class="search-bar block"></div>
        <ul>
          <li id="coffee" data-vt-href="${origin}/en/search?facetFilters=coffee"></li>
          <li id="machines" data-vt-href="${origin}/en/search?facetFilters=machines"></li>
        </ul>
      </div>
    </main>`;
}

function renderSearch() {
  document.body.className = 'appear';
  document.body.innerHTML = `
    <header></header>
    <main>
      <div class="section" data-section-status="loaded">
        <div class="search-bar block"></div>
        <div class="search-results block"><div class="images-main"></div></div>
      </div>
    </main>`;
}

beforeAll(async () => {
  window.PageRevealEvent = class PageRevealEvent {};
  HTMLScriptElement.supports = (type) => type === 'speculationrules';
  await import('../page-transitions.js');
});

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    top: 10, bottom: 110, left: 0, right: 100, width: 100, height: 100,
  });
  window.history.replaceState({}, '', '/en/');
});

afterEach(() => {
  delete window.navigation;
  vi.restoreAllMocks();
});

describe('setup', () => {
  it('adds the opt-in stylesheet and the prerender rules', () => {
    expect(document.head.querySelector('link[href$="/styles/page-transitions.css"]')).not.toBeNull();
    const rules = document.head.querySelector('script[type="speculationrules"][data-prerender-rules]');
    expect(JSON.parse(rules.textContent).prerender[0].eagerness).toBe('moderate');
  });
});

describe('pagereveal', () => {
  it('skips the transition when the page has not been decorated yet', () => {
    renderSearch();
    document.body.className = '';
    const vt = fakeTransition();
    dispatch('pagereveal', { viewTransition: vt });
    expect(vt.skipTransition).toHaveBeenCalled();
    expect(name('header')).toBe('');
  });

  it('names header, search box and results area when arriving from the home page', async () => {
    renderSearch();
    window.history.replaceState({}, '', '/en/search?facetFilters=coffee');
    window.navigation = {
      activation: {
        navigationType: 'push',
        from: { url: `${origin}/en/`, index: 0 },
        entry: { url: window.location.href, index: 1 },
      },
    };
    const vt = fakeTransition();
    dispatch('pagereveal', { viewTransition: vt });

    expect(vt.skipTransition).not.toHaveBeenCalled();
    expect(name('header')).toBe('vt-site-header');
    expect(name('.search-bar')).toBe('vt-search-box');
    expect(name('.images-main')).toBe('vt-hero');
    expect([...vt.types]).toEqual(['page-nav', 'page-forward']);

    vt.finish();
    await vt.finished;
    await Promise.resolve();
    expect(name('header')).toBe('');
    expect(name('.images-main')).toBe('');
  });

  it('names the matching card when going back to the home page', () => {
    renderHome();
    window.navigation = {
      activation: {
        navigationType: 'traverse',
        from: { url: `${origin}/en/search?facetFilters=machines`, index: 2 },
        entry: { url: `${origin}/en/`, index: 1 },
      },
    };
    const vt = fakeTransition();
    dispatch('pagereveal', { viewTransition: vt });

    expect(name('#machines')).toBe('vt-hero');
    expect(name('#coffee')).toBe('');
    expect(vt.types.has('page-back')).toBe(true);
  });

  it('does not name the results area when the other page has no cards', () => {
    renderSearch();
    window.navigation = {
      activation: {
        navigationType: 'push',
        from: { url: `${origin}/en/report-hub`, index: 0 },
        entry: { url: window.location.href, index: 1 },
      },
    };
    dispatch('pagereveal', { viewTransition: fakeTransition() });
    expect(name('.images-main')).toBe('');
    expect(name('header')).toBe('vt-site-header');
  });

  it('falls back to the collection block when the grid is still empty', () => {
    document.body.className = 'appear';
    document.body.innerHTML = `
      <header></header>
      <main><div class="section" data-section-status="loaded">
        <div class="collection-details block">
          <div class="collection-details-inner search-results">
            <span class="cd-breadcrumb-name">Summer</span>
            <div class="images-main"></div>
          </div>
        </div>
      </div></main>`;
    const emptyGrid = document.querySelector('.images-main');
    Element.prototype.getBoundingClientRect.mockImplementation(function rect() {
      return this === emptyGrid
        ? {
          top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0,
        }
        : {
          top: 10, bottom: 110, left: 0, right: 100, width: 100, height: 100,
        };
    });
    window.history.replaceState({}, '', '/en/collection-details?id=1');
    window.navigation = {
      activation: {
        navigationType: 'push',
        from: { url: `${origin}/en/search-collections`, index: 0 },
        entry: { url: window.location.href, index: 1 },
      },
    };
    dispatch('pagereveal', { viewTransition: fakeTransition() });
    expect(name('.images-main')).toBe('');
    expect(name('.collection-details-inner')).toBe('vt-hero');
    expect(name('.cd-breadcrumb-name')).toBe('vt-title');
  });

  it('does nothing without a view transition', () => {
    renderSearch();
    dispatch('pagereveal', { viewTransition: null });
    expect(name('header')).toBe('');
  });
});

describe('reports', () => {
  it('grows the report hub card into the report page', () => {
    document.body.className = 'appear';
    document.body.innerHTML = `
      <header></header>
      <main><div class="section" data-section-status="loaded">
        <div class="searches-report-container"><h1 class="searches-title">Searches</h1></div>
      </div></main>`;
    window.history.replaceState({}, '', '/en/reports/searches');
    window.navigation = {
      activation: {
        navigationType: 'push',
        from: { url: `${origin}/en/reports/report-hub`, index: 0 },
        entry: { url: window.location.href, index: 1 },
      },
    };
    dispatch('pagereveal', { viewTransition: fakeTransition() });
    expect(name('.searches-report-container')).toBe('vt-hero');
    expect(name('.searches-title')).toBe('vt-title');
  });
});

describe('nav underline', () => {
  it('names the active nav underline so it can slide to the new item', () => {
    renderSearch();
    document.querySelector('header').innerHTML = `
      <nav><div class="nav-sections"><a class="active" href="/en/search">Search<span class="nav-active-underline"></span></a></div></nav>`;
    dispatch('pagereveal', { viewTransition: fakeTransition() });
    expect(name('.nav-active-underline')).toBe('vt-nav-underline');
  });
});

describe('pageswap', () => {
  it('names the clicked card and its title for the destination page', () => {
    renderHome();
    document.querySelector('#coffee').innerHTML = '<div class="scr-card-name">Coffee</div>';
    const vt = fakeTransition();
    dispatch('pageswap', {
      viewTransition: vt,
      activation: {
        navigationType: 'push',
        entry: { url: `${origin}/en/search?facetFilters=coffee`, index: 1 },
        from: { url: window.location.href, index: 0 },
      },
    });
    expect(name('#coffee')).toBe('vt-hero');
    expect(name('#coffee .scr-card-name')).toBe('vt-title');
    expect(name('#machines')).toBe('');
    expect(name('.search-bar')).toBe('vt-search-box');
  });

  it('falls back to the last clicked card when activation info is missing', () => {
    renderHome();
    document.querySelector('#machines').click();
    dispatch('pageswap', { viewTransition: fakeTransition(), activation: null });
    expect(name('#machines')).toBe('vt-hero');
  });

  it('ignores cards that are off screen', () => {
    renderHome();
    Element.prototype.getBoundingClientRect.mockReturnValue({
      top: 5000, bottom: 5100, left: 0, right: 100, width: 100, height: 100,
    });
    dispatch('pageswap', {
      viewTransition: fakeTransition(),
      activation: { navigationType: 'push', entry: { url: `${origin}/en/search?facetFilters=coffee` } },
    });
    expect(name('#coffee')).toBe('');
  });

  it('clears names when the page is restored from the back/forward cache', () => {
    renderHome();
    dispatch('pageswap', {
      viewTransition: fakeTransition(),
      activation: { navigationType: 'push', entry: { url: `${origin}/en/search?facetFilters=coffee` } },
    });
    expect(name('#coffee')).toBe('vt-hero');
    dispatch('pageshow', { persisted: true });
    expect(name('#coffee')).toBe('');
  });
});
