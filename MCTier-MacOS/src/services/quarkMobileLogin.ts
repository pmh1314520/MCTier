export const QUARK_MOBILE_ORIGIN = 'https://uop.quark.cn';
export const QUARK_MOBILE_URL = `${QUARK_MOBILE_ORIGIN}/cas/custom/login?custom_login_type=mobile&client_id=532&display=pc`;

// CAS posts only its service ticket after the user completes the official form.
// Both the exact origin and the current frame must match; never accept other frames.
export function quarkMobileTicket(
  event: Pick<MessageEvent, 'origin' | 'source' | 'data'>,
  expectedSource: Window | null
): string | null {
  return expectedSource !== null &&
    event.origin === QUARK_MOBILE_ORIGIN &&
    event.source === expectedSource &&
    typeof event.data === 'string' &&
    event.data.length === 32 &&
    /^[A-Za-z0-9]{32}$/.test(event.data)
    ? event.data
    : null;
}
