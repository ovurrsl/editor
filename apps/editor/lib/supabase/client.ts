import type { SupabaseDatabase } from '@pascal-app/db'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'

/**
 * Supabase client for client-side use with anon key
 * Uses Row Level Security (RLS) policies
 */
export const supabase = createClient<SupabaseDatabase>(supabaseUrl, supabaseAnonKey)
