/**
 * Path A — self-host the proxied site under the dispatcher's FIXED web-action
 * prefix (e.g. /api/v1/web/spark/dispatcher) WITHOUT a custom domain/CDN.
 *
 * The Cloudflare Worker sat at the domain ROOT, so both the app and the proxied
 * EDS HTML use ROOT-ABSOLUTE paths (/scripts, /styles, /en, /api). Under the
 * action prefix those all miss (they resolve to the bare domain root -> 404).
 * This module rewrites them so the browser stays under the prefix.
 *
 * Two distinct problems are handled:
 *   1. Root-absolute URLs  -> prefixed with BASE_PATH.
 *   2. Reserved web-action extensions (FINDINGS.md limit #13): a URL ending in
 *      .svg/.json/.html/.text/.http is intercepted by the OpenWhisk gateway and
 *      400s. Such requests are routed through a NON-reserved proxy endpoint
 *      (/x-asset?p=<subpath>) so the bytes come back intact.
 *
 * The 1 MB / no-streaming response cap (limit #1) is NOT solvable here — assets
 * bigger than ~1 MB still fail. That is the one genuinely absolute wall.
 */

export const ASSET_PROXY_PATH = '/x-asset';

// Extensions the OpenWhisk web-action gateway reserves as response projections.
const RESERVED_EXT_RE = /\.(svg|json|html|text|http)(?:$|\?)/i;

/** True when a path would be intercepted by the reserved-extension gateway. */
export function isReservedExtPath(p) {
  return RESERVED_EXT_RE.test(p);
}

/** Prefix a root-absolute path with the base (no-op when base is empty). */
export function withBase(base, p) {
  if (!base || typeof p !== 'string' || !p.startsWith('/') || p.startsWith('//')) return p;
  if (p === base || p.startsWith(`${base}/`)) return p; // already prefixed
  return base + p;
}

/** Build the reserved-ext-safe proxy URL for a root-absolute sub-path. */
export function assetProxyUrl(base, subPath) {
  return `${base}${ASSET_PROXY_PATH}?p=${encodeURIComponent(subPath)}`;
}

/**
 * Rewrite one root-absolute URL value:
 *   - reserved-ext -> /x-asset proxy endpoint
 *   - otherwise    -> prefixed with base
 * Leaves external (//, http(s)://), relative (./, ../), fragment (#) and
 * data:/mailto: values untouched.
 */
export function rewriteRootAbsolute(base, value) {
  if (!base || typeof value !== 'string') return value;
  if (!value.startsWith('/') || value.startsWith('//')) return value;
  if (value.startsWith(`${base}/`) || value.startsWith(`${base}${ASSET_PROXY_PATH}`)) return value;
  if (isReservedExtPath(value)) return assetProxyUrl(base, value);
  return withBase(base, value);
}

/**
 * Inline <script> injected as the FIRST thing in <head>. It runs before the
 * EDS module scripts and patches fetch/XHR so RUNTIME-constructed root-absolute
 * requests (API calls, EDS nav/footer fragments, query-index.json, block data)
 * stay under the prefix and dodge reserved extensions. Also pins codeBasePath
 * so EDS loads blocks/styles from the prefixed path.
 */
function shimScript(base) {
  const cfg = JSON.stringify({ base, proxy: ASSET_PROXY_PATH });
  return `<script>(function(){
  var C=${cfg},BASE=C.base,PXP=C.proxy,PROXY=BASE+C.proxy,RES=/\\.(svg|json|html|text|http)(?:$|\\?)/i;
  window.hlx=window.hlx||{};window.hlx.codeBasePath=BASE;
  // Canonicalize any URL to a base-relative sub-path, then re-apply routing.
  // This is idempotent: already-based paths (e.g. produced by the patched
  // localizePath) are stripped back to the sub-path so reserved-extension
  // assets still route through /x-asset instead of 400ing.
  function map(u){try{
    if(u==null)return u;var O=location.origin,p=String(u);
    if(p.indexOf(O)===0)p=p.slice(O.length)||'/';
    if(p.charAt(0)!=='/'||p.charAt(1)==='/')return u;
    if(BASE){if(p===BASE)p='/';else if(p.indexOf(BASE+'/')===0)p=p.slice(BASE.length);}
    if(p.indexOf(PXP)===0)return BASE+p;
    if(RES.test(p))return PROXY+'?p='+encodeURIComponent(p);
    return BASE+p;
  }catch(e){return u;}}
  var of=window.fetch;
  window.fetch=function(input,init){try{
    if(typeof input==='string')input=map(input);
    else if(input&&input.url)input=new Request(map(input.url),input);
  }catch(e){}return of.call(this,input,init);};
  var oo=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,u){try{arguments[1]=map(u);}catch(e){}return oo.apply(this,arguments);};
  // Root-absolute resources injected via innerHTML / img.src fire their request
  // BEFORE a MutationObserver can rewrite them, causing a transient 404 (esp. the
  // many .svg icons). Rewrite at the SOURCE so the first request is already correct:
  //  - HTMLImageElement.src setter (EDS getIcon: img.src = codeBasePath+'/icons/x.svg')
  //  - Element innerHTML setter + insertAdjacentHTML (block markup with <img src="/icons/…">)
  function rw(h){try{if(typeof h!=='string'||h.indexOf('/')<0)return h;
    h=h.replace(/\\b(src|href)=(["'])(\\/[^"'>]*)\\2/gi,function(m,a,q,v){var n=map(v);return n!==v?a+'='+q+n+q:m;});
    return h.replace(/\\bsrcset=(["'])([^"']*)\\1/gi,function(m,q,v){var n=v.replace(/(^|,\\s*)(\\/[^\\s,]+)/g,function(_,p,u){return p+map(u);});return n!==v?'srcset='+q+n+q:m;});
  }catch(e){return h;}}
  try{var IP=(window.HTMLImageElement||{}).prototype,SD=IP&&Object.getOwnPropertyDescriptor(IP,'src');
    if(SD&&SD.set)Object.defineProperty(IP,'src',{configurable:true,enumerable:SD.enumerable,get:SD.get,set:function(v){return SD.set.call(this,map(v));}});}catch(e){}
  try{var EP=Element.prototype,DH=Object.getOwnPropertyDescriptor(EP,'innerHTML');
    if(DH&&DH.set)Object.defineProperty(EP,'innerHTML',{configurable:true,enumerable:DH.enumerable,get:DH.get,set:function(v){return DH.set.call(this,rw(v));}});
    var IA=EP.insertAdjacentHTML;if(IA)EP.insertAdjacentHTML=function(pos,h){return IA.call(this,pos,rw(h));};
    var SA=EP.setAttribute;if(SA)EP.setAttribute=function(n,v){try{if(typeof v==='string'&&n){var l=(''+n).toLowerCase();
      if(l==='src'||l==='href')v=map(v);
      else if(l==='srcset')v=v.replace(/(^|,\\s*)(\\/[^\\s,]+)/g,function(_,p,u){return p+map(u);});}}catch(e){}return SA.call(this,n,v);};}catch(e){}
  // Backstop for other injection paths (createElement + setAttribute, etc.).
  function mapset(u){var v=map(u);return v!==u?v:null;}
  function fix(el){if(!el||el.nodeType!==1||!el.getAttribute)return;
    ['src','href'].forEach(function(a){var x=el.getAttribute(a);if(x){var m=mapset(x);if(m)el.setAttribute(a,m);}});
    var ss=el.getAttribute('srcset');
    if(ss){var m=ss.replace(/(^|,\\s*)(\\/[^\\s,]+)/g,function(_,p,u){return p+map(u);});if(m!==ss)el.setAttribute('srcset',m);}}
  try{new MutationObserver(function(ms){for(var i=0;i<ms.length;i++){var an=ms[i].addedNodes;for(var j=0;j<an.length;j++){var n=an[j];fix(n);if(n.querySelectorAll){var q=n.querySelectorAll('[src],[href],[srcset]');for(var k=0;k<q.length;k++)fix(q[k]);}}}}).observe(document.documentElement,{childList:true,subtree:true});}catch(e){}
})();</script>`;
}

/**
 * Rewrite served HTML: prefix/route root-absolute href|src attributes and
 * inject the runtime shim. No-op when base is empty (local root serving).
 */
export function rewriteHtml(html, base) {
  if (!base || !html) return html;
  const out = html.replace(
    /\b(href|src)=(["'])(\/[^"'>]*)\2/gi,
    (m, attr, q, val) => `${attr}=${q}${rewriteRootAbsolute(base, val)}${q}`,
  );
  const shim = shimScript(base);
  if (/<head[^>]*>/i.test(out)) return out.replace(/<head[^>]*>/i, (m) => m + shim);
  return shim + out;
}

// Exact source signature of the frontend's localizePath (scripts/locale-utils.js).
// Used as the anchor for the Path A on-the-fly override below.
const LOCALIZE_PATH_MARKER = 'export function localizePath(path) {';

/**
 * Path A — make the proxied frontend's localizePath() base-path aware.
 *
 * localizePath() builds ROOT-ABSOLUTE app paths (e.g. /en/search) that the app
 * then navigates to via `window.location.href = ...`. Full-page navigations
 * cannot be intercepted by the injected shim (the Location interface is
 * unforgeable), so we instead rewrite the ONE proxied JS module that produces
 * those paths: rename the original function and export a wrapper that prefixes
 * the dispatcher base (skipping resource/proxy paths the shim already handles,
 * and staying idempotent for already-based results).
 *
 * Fails closed: if the exact marker is absent (frontend refactor) or base is
 * empty (local root serving), the source is returned UNCHANGED.
 */
export function rewriteLocalizeJs(js, base) {
  if (!base || typeof js !== 'string' || !js.includes(LOCALIZE_PATH_MARKER)) return js;
  const renamed = js.replace(LOCALIZE_PATH_MARKER, 'function __lpBase(path) {');
  const wrapper = '\n/* Path A: base-path-aware localizePath (injected by App Builder dispatcher) */\n'
    + 'export function localizePath(p){try{'
    + "var b=(typeof window!=='undefined'&&window.hlx&&window.hlx.codeBasePath)||'';"
    + 'var r=__lpBase(p);'
    + "if(b&&typeof r==='string'&&r.charAt(0)==='/'&&r!==b&&r.indexOf(b+'/')!==0){"
    + "var sp=['/api','/scripts','/icons','/styles','/media_','/x-asset'];"
    + 'for(var i=0;i<sp.length;i++){if(r.indexOf(sp[i])===0)return r;}'
    + 'return b+r;}'
    + 'return r;}catch(e){return __lpBase(p);}}\n';
  return renamed + wrapper;
}

/**
 * Path A — rewrite root-absolute url() references in proxied CSS. CSS
 * background/mask images (e.g. `mask: url('/icons/arrow-black.svg')`) are
 * fetched by the browser relative to the ORIGIN root, bypassing every JS hook,
 * so they must be rewritten in the stylesheet itself: reserved-ext assets go
 * through /x-asset, the rest are base-prefixed. Values are re-quoted so the
 * proxy query string is a valid CSS url token. No-op when base is empty.
 */
export function rewriteCss(css, base) {
  if (!base || typeof css !== 'string') return css;
  return css.replace(
    /url\(\s*(['"]?)(\/(?!\/)[^'")\s]+)\1\s*\)/gi,
    (m, q, val) => `url("${rewriteRootAbsolute(base, val)}")`,
  );
}
