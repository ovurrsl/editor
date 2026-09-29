import type { SupabaseDatabase } from '@pascal-app/db'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder'

// Supabase branching safety check: on a Vercel preview, the integration sets a
// branch-specific SUPABASE_URL. If it equals NEXT_PUBLIC_SUPABASE_URL (production),
// branching was skipped for this PR and the preview is writing to production.
if (
  process.env.VERCEL_ENV === 'preview' &&
  process.env.SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_URL === process.env.SUPABASE_URL
) {
  console.warn(
    '⚠️  [supabase] Preview deployment appears to be using the PRODUCTION Supabase instance. ' +
      'Supabase branching may not be configured for this PR. ' +
      'See: https://supabase.com/docs/guides/deployment/branching',
  )
}

/**
 * Supabase client for server-side use with service role key
 * Bypasses Row Level Security (RLS) - use with caution
 * Always filter by user_id to enforce permissions
 */
export const supabaseAdmin = createClient<SupabaseDatabase>(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})
