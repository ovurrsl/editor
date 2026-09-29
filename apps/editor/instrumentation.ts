const PUBLIC_BUCKETS = [
  {
    name: 'avatars',
    fileSizeLimit: 5 * 1024 * 1024,
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  },
  { name: 'project-thumbnails', fileSizeLimit: 10 * 1024 * 1024, allowedMimeTypes: ['image/png'] },
  { name: 'project-assets', fileSizeLimit: 500 * 1024 * 1024 },
  { name: 'feedback-images', fileSizeLimit: 5 * 1024 * 1024 },
]

// Creates the storage buckets the community features upload to, so a fresh
// Supabase project works without running the storage migrations by hand.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!(url && key)) return

  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(url, key)

  const { data: buckets, error } = await supabase.storage.listBuckets()
  if (error) return
  const existing = new Set(buckets.map((bucket) => bucket.name))

  for (const { name, ...options } of PUBLIC_BUCKETS) {
    if (existing.has(name)) continue
    await supabase.storage.createBucket(name, { public: true, ...options })
    console.log(`Created "${name}" storage bucket`)
  }
}
