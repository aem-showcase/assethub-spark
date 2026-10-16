/**
 * Toast notification component
 * Displays temporary notification messages to users
 */

/**
 * Show a toast notification
 * @param {string} message - Message to display
 * @param {string} type - Type of toast ('success', 'error', 'info')
 * @param {Object} options - Optional configuration
 * @param {number} options.timeout - Duration in milliseconds (default: 3000)
 * @param {string} options.actionLabel - Optional action label
 * @param {string} options.actionHref - Optional action destination
 * @returns {HTMLElement} The created toast
 */
export default function showToast(message, type = 'success', options = {}) {
  const timeout = options.timeout || 3000;

  // Create toast element
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');

  const text = document.createElement('span');
  text.className = 'toast-message';
  text.textContent = message;
  toast.appendChild(text);

  if (options.actionLabel && options.actionHref) {
    const action = document.createElement('a');
    action.className = 'toast-action';
    action.href = options.actionHref;
    action.textContent = options.actionLabel;
    toast.appendChild(action);
  }

  // Add to document
  document.body.appendChild(toast);

  // Trigger animation
  setTimeout(() => {
    toast.classList.add('show');
  }, 10);

  // Remove after timeout
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      if (toast.parentNode) {
        document.body.removeChild(toast);
      }
    }, 300);
  }, timeout);

  return toast;
}

/**
 * ToastQueue API - Compatible with React Spectrum ToastQueue
 * Provides positive(), negative(), info(), and neutral() methods
 */
export const ToastQueue = {
  positive: (message, options) => showToast(message, 'success', options),
  negative: (message, options) => showToast(message, 'error', options),
  info: (message, options) => showToast(message, 'info', options),
  neutral: (message, options) => showToast(message, 'info', options),
};

// Make ToastQueue available globally for compatibility
if (typeof window !== 'undefined') {
  window.ToastQueue = ToastQueue;
}
