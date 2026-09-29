import { BASE_URL, isPreview } from './utils'

/**
 * Origin Better Auth runs on, and so the origin of the Google OAuth callback.
 * Preview deploys use the Vercel branch URL: it is stable across pushes and can be
 * registered as a redirect URI, whereas VERCEL_URL changes on every deploy.
 * Kept out of `utils.ts` so that file stays identical to upstream.
 */
export const AUTH_BASE_URL = (() => {
  const branchHost = process.env.NEXT_PUBLIC_VERCEL_BRANCH_URL || process.env.VERCEL_BRANCH_URL
  if (isPreview && branchHost) {
    return `https://${branchHost}`
  }
  return BASE_URL
})()
