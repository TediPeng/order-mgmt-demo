/**
 * UI preferences persisted in cookies so the server can render the right shell
 * on first paint — reading them after hydration would flash the wrong layout.
 *
 * Deliberately NOT declared inside a "use client" module: every export of such a
 * module becomes a client reference, so a server component importing the name
 * would not receive the plain string and the lookup would silently miss.
 */
export const SIDEBAR_COOKIE = "sidebar_collapsed";

/** One year, scoped to this browser. */
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
