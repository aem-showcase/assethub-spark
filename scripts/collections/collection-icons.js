/**
 * Inline SVG icon constants shared by the collections blocks.
 * Kept as inline-SVG (not background-image) so callers retain `currentColor` theming.
 *
 * Use one of these constants as the `innerHTML` of a button/span, or as the `icon`
 * field of a picker/menu option.
 *
 * Sizing convention:
 *   `*_SM` = 16px square (kebab-menu rows)
 *   `*_MD` = 18px square (toolbar action buttons)
 *   `*_LG` = larger / non-square illustrations
 */

export const ICON_PERSON_SM = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="10" cy="6.5" r="3.5" stroke="currentColor" stroke-width="1.3"/>
  <path d="M3 18c0-3.866 3.134-6 7-6s7 2.134 7 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
</svg>`;

export const ICON_EDIT_SM = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M11.5 2.5l2 2-8 8H3.5v-2l8-8z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" fill="none"/>
</svg>`;

export const ICON_DELETE_SM = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M3 5h10M6 5V3h4v2M6.5 8v4M9.5 8v4M4 5l1 8h6l1-8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export const ICON_DOWNLOAD_SM = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M8 2.5v6M5.5 6.5 8 9l2.5-2.5M3 12.5h10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export const ICON_PEOPLE_MD = `<svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="6" cy="5.5" r="2.5" stroke="currentColor" stroke-width="1.2"/>
  <path d="M1.5 13c0-2.485 2.015-4 4.5-4s4.5 1.515 4.5 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  <path d="M10.5 7a2 2 0 1 0 0-4M11 13h3.5c0-2-1.5-3.5-3.5-3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
</svg>`;

export const ICON_EDIT_MD = `<svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M11.5 2.5l2 2-8 8H3.5v-2l8-8z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" fill="none"/>
</svg>`;

export const ICON_DELETE_MD = `<svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M3 5h10M6 5V3h4v2M6.5 8v4M9.5 8v4M4 5l1 8h6l1-8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export const ICON_DOWNLOAD_MD = `<svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M8 2.5v6M5.5 6.5 8 9l2.5-2.5M3 12.5h10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export const ICON_STAR_SM = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M8 1.5l1.545 3.13 3.455.502-2.5 2.437.59 3.44L8 9.387l-3.09 1.622.59-3.44L3 5.132l3.455-.503z"
    stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
</svg>`;

export const ICON_PIN_SM = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M9.5 2.5l4 4-1.5 1.5-1-.5-3 3 .5 1.5-1.5 1.5-2-2-2.5 2.5-.5-.5 2.5-2.5-2-2 1.5-1.5 1.5.5 3-3-.5-1z"
    stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" fill="none"/>
</svg>`;

export const ICON_GRID_SM = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.2"/></svg>';

export const ICON_SMART_COLLECTION_SM = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" data-testid="collection-icon" data-collection-variant="smart" data-has-lightning="true" focusable="false" role="img">
  <path d="M9.25 9.25H8V4.5H12V6.25C12 6.66406 12.3359 7 12.75 7C13.1641 7 13.5 6.66406 13.5 6.25V4.5H16.75C17.1631 4.5 17.5 4.83691 17.5 5.25V7.44629C17.5 7.86035 17.8359 8.19629 18.25 8.19629C18.6641 8.19629 19 7.86035 19 7.44629V5.25C19 4.00977 17.9902 3 16.75 3H3.25C2.00977 3 1 4.00977 1 5.25V14.75C1 15.9902 2.00977 17 3.25 17H7.25C7.66406 17 8 16.6641 8 16.25V10.75H9.25C9.66406 10.75 10 10.4141 10 10C10 9.58594 9.66406 9.25 9.25 9.25ZM3.25 4.5H6.5V9.25H2.5V5.25C2.5 4.83691 2.83691 4.5 3.25 4.5ZM6.5 15.5H3.25C2.83691 15.5 2.5 15.1631 2.5 14.75V10.75H6.5V15.5Z" fill="currentColor"></path>
  <g fill="currentColor">
    <path d="M14.6545 19.3632C14.4856 19.3632 14.3127 19.329 14.1457 19.2567C13.5656 19.0067 13.2717 18.4052 13.4309 17.7938L14.0852 15.2802H11.9494C11.4973 15.2802 11.0793 15.0351 10.8586 14.6415C10.6379 14.248 10.6467 13.7636 10.883 13.3778L14.4231 7.60244C14.7532 7.06338 15.3889 6.85635 15.9748 7.10342C16.5569 7.34854 16.8557 7.94717 16.7014 8.56045L16.0178 11.2802H18.1506C18.6057 11.2802 19.0246 11.5273 19.2444 11.9257C19.4651 12.3232 19.4514 12.8105 19.2102 13.1952L15.6985 18.7743C15.4602 19.1532 15.0686 19.3632 14.6545 19.3632ZM12.3948 13.7802H14.4094C14.8 13.7802 15.1604 13.9579 15.3987 14.2665C15.6369 14.5761 15.717 14.9696 15.6184 15.3466L15.2893 16.6083L17.6985 12.7802H15.6975C15.3098 12.7802 14.9504 12.6054 14.7121 12.2997C14.4729 11.9941 14.3909 11.6024 14.4846 11.2265L14.8479 9.7792L12.3948 13.7802Z" fill="inherit"></path>
    <path d="M7.00085 15.5H9.25C9.66406 15.5 10 15.8359 10 16.25C10 16.6641 9.66406 17 9.25 17H7.00085L7 15.75L7.00085 15.5Z" fill="inherit"></path>
  </g>
</svg>`;

export const ICON_PERSON_FILTER = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="5" r="3" stroke="currentColor" stroke-width="1.2"/><path d="M2 14c0-3.314 2.686-5 6-5s6 1.686 6 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';

export const ICON_GLOBE_SM = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2"/><path d="M8 2c0 0-3 2-3 6s3 6 3 6M8 2c0 0 3 2 3 6s-3 6-3 6M2 8h12" stroke="currentColor" stroke-width="1.2"/></svg>';

export const ICON_LOCK_SM = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';

export const PLACEHOLDER_SVG = `<svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="6" y="10" width="36" height="28" rx="3" fill="#f0f0f0" stroke="#e0e0e0" stroke-width="1.5"/>
  <rect x="10" y="14" width="12" height="9" rx="1.5" fill="#ddd"/>
  <rect x="24" y="14" width="14" height="4" rx="1" fill="#e8e8e8"/>
  <rect x="24" y="20" width="10" height="3" rx="1" fill="#ebebeb"/>
  <rect x="10" y="26" width="28" height="3" rx="1" fill="#ebebeb"/>
  <rect x="10" y="31" width="20" height="3" rx="1" fill="#ebebeb"/>
</svg>`;
