/**
 * Prefixes a path in `public/` with the deployment's base path.
 *
 * Next rewrites `<Link>` hrefs and its own `_next/` asset URLs for `basePath`
 * automatically, but it cannot rewrite a string handed to `fetch()`. On a
 * project GitHub Pages site the app is served from `/ledgr`, so a bare
 * `fetch("/ledgr-sample-data.xlsx")` resolves against the domain root and 404s —
 * which broke the sample-data button on the deployed site while working
 * perfectly in local development.
 *
 * Anything fetched from `public/` has to go through here.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * False on a static deployment, where `app/api/digest` cannot exist.
 *
 * Settings uses this to say so before the user turns digests on, instead of
 * letting them fill in an address and discover the failure on first send.
 */
export const DIGESTS_AVAILABLE = process.env.NEXT_PUBLIC_STATIC_EXPORT !== "1";

export function assetPath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${BASE_PATH}${normalized}`;
}
