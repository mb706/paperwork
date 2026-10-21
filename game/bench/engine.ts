// The engine family of a browser's user agent, as this host's browser runners name theirs (bench/calibrate.ts; the M0
// exit audit #8, C9): only an engine this host ran can be compared with the user's.

/**
 * Chromium's engine (Chrome, Chromium, Edge, Opera, Brave …: Blink and V8) or Firefox's (Gecko and SpiderMonkey);
 * null for any other (Safari's WebKit and JavaScriptCore, which this host cannot run): never a guess.
 */
export function engineOf(ua: string): 'chrome' | 'firefox' | null {
  if (/\bFirefox\/\d/.test(ua)) return 'firefox';
  if (/\b(?:Chrome|Chromium|HeadlessChrome|Edg|OPR)\/\d/.test(ua)) return 'chrome';
  return null;
}
