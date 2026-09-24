import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const isDevelopment =
  process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_VERCEL_ENV === 'development'

export const isProduction =
  process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_VERCEL_ENV === 'production'

export const isPreview = process.env.NEXT_PUBLIC_VERCEL_ENV === 'preview'

/**
 * Base URL for the application
 * Uses NEXT_PUBLIC_* variables which are available at build time
 */
export const BASE_URL = (() => {
  // Development: localhost
  if (isDevelopment) {
    return process.env.NEXT_PUBLIC_APP_URL || `http://localhost:${process.env.PORT || 3000}`
  }

  // Preview deployments: the branch URL is stable across pushes, so it is the one
  // that can be registered as an OAuth redirect URI. VERCEL_URL changes per deploy.
  const previewHost =
    process.env.NEXT_PUBLIC_VERCEL_BRANCH_URL ||
    process.env.VERCEL_BRANCH_URL ||
    process.env.NEXT_PUBLIC_VERCEL_URL
  if (isPreview && previewHost) {
    return `https://${previewHost}`
  }

  // Production: use custom domain or Vercel production URL
  if (isProduction) {
    return (
      process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL}`
        : 'https://editor.pascal.app')
    )
  }

  // Fallback (should never reach here in normal operation)
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
})()
