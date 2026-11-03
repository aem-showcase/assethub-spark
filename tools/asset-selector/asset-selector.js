// eslint-disable-next-line import/no-unresolved, import/extensions
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
// eslint-disable-next-line import/no-unresolved, import/extensions
import { DELIVERY_ORIGIN } from '../../scripts/dm-images.js?v=20261102-da-selector';

const REPOSITORY_ID = new URL(DELIVERY_ORIGIN).hostname;
const SELECTOR_SCRIPT = 'https://experience.adobe.com/solutions/CQ-assets-selectors/static-assets/resources/assets-selectors.js';
const ASSET_ID = /^urn:aaid:aem:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const status = document.getElementById('status');
const retry = document.getElementById('retry');
const container = document.getElementById('asset-selector');

function showError(error) {
  container.hidden = true;
  status.hidden = false;
  status.setAttribute('role', 'alert');
  status.textContent = error instanceof Error ? error.message : String(error);
  retry.hidden = false;
  // eslint-disable-next-line no-console
  console.error('[DA asset selector]', error);
}

function loadSelector() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = window.setTimeout(() => {
      script.remove();
      reject(new Error('Adobe Asset Selector timed out. Reload the selector to try again.'));
    }, 30000);
    script.src = SELECTOR_SCRIPT;
    script.async = true;
    script.addEventListener('load', () => {
      window.clearTimeout(timeout);
      if (typeof window.PureJSSelectors?.renderAssetSelector !== 'function') {
        reject(new Error('Adobe Asset Selector did not initialize.'));
        return;
      }
      resolve(window.PureJSSelectors);
    }, { once: true });
    script.addEventListener('error', () => {
      window.clearTimeout(timeout);
      reject(new Error('Adobe Asset Selector could not be loaded. Check your connection.'));
    }, { once: true });
    document.head.append(script);
  });
}

function getDeliveryUrl(asset) {
  const id = asset?.['repo:assetId'];
  const name = asset?.['repo:name'];
  const mimetype = asset?.mimetype || asset?.['dc:format'];
  if (typeof id !== 'string' || !ASSET_ID.test(id)) {
    throw new Error('The selected asset has no valid delivery ID.');
  }
  if (typeof name !== 'string' || !name.trim() || typeof mimetype !== 'string' || !mimetype.trim()) {
    throw new Error('The selected asset is missing its filename or media type.');
  }

  const base = `${DELIVERY_ORIGIN}/adobe/assets/${id}`;
  if (mimetype.toLowerCase().startsWith('image/')) {
    const basename = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name;
    return `${base}/as/${encodeURIComponent(basename)}.avif`;
  }
  if (mimetype.toLowerCase().startsWith('video/')) return `${base}/play`;
  return `${base}/original/as/${encodeURIComponent(name)}`;
}

async function connectToDa() {
  let timeout;
  try {
    return await Promise.race([
      DA_SDK,
      new Promise((resolve, reject) => {
        timeout = window.setTimeout(() => {
          reject(new Error('DA did not connect. Open DM Assets from the document Library.'));
        }, 15000);
      }),
    ]);
  } finally {
    window.clearTimeout(timeout);
  }
}

async function init() {
  try {
    if (window.parent === window) {
      throw new Error('Open this plugin from the DA document Library, not in a standalone tab.');
    }

    const { token, actions } = await connectToDa();
    if (typeof token !== 'string' || !token.trim()) {
      throw new Error('DA did not provide an Adobe access token. Sign into DA and reopen DM Assets.');
    }
    if (typeof actions?.sendHTML !== 'function' || typeof actions?.closeLibrary !== 'function') {
      throw new Error('This DA host does not support document insertion.');
    }

    status.textContent = 'Loading Adobe Asset Selector...';
    const selectors = await loadSelector();
    container.hidden = false;
    selectors.renderAssetSelector(container, {
      imsToken: token,
      repositoryId: REPOSITORY_ID,
      aemTierType: 'delivery',
      selectionType: 'single',
      featureSet: ['upload', 'collections', 'detail-panel', 'advisor', 'dynamic-media'],
      onClose: () => actions.closeLibrary(),
      handleSelection: (assets) => {
        try {
          if (!Array.isArray(assets) || assets.length !== 1) {
            throw new Error('Select exactly one asset to insert.');
          }
          const href = getDeliveryUrl(assets[0]);
          const paragraph = document.createElement('p');
          const link = document.createElement('a');
          link.href = href;
          link.textContent = href;
          paragraph.append(link);
          actions.sendHTML(paragraph.outerHTML);
          actions.closeLibrary();
        } catch (error) {
          showError(error);
        }
      },
    });
    status.hidden = true;
  } catch (error) {
    showError(error);
  }
}

retry.addEventListener('click', () => window.location.reload());
init();
