'use client'

import { LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { useSession } from '@/components/auth/session-provider'

export function SignOutButton({ className }: { className?: string } = {}) {
  const router = useRouter()
  const { signOut } = useSession()
  const [signingOut, setSigningOut] = useState(false)

  const handleSignOut = useCallback(async () => {
    setSigningOut(true)
    await signOut()
    router.push('/signin')
  }, [router, signOut])

  return (
    <button
      className={
        className ??
        'flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-medium text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50'
      }
      disabled={signingOut}
      onClick={() => void handleSignOut()}
      type="button"
    >
      <LogOut className="size-4" />
      {signingOut ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
