export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { SettingsPage } from '@/features/community/components/settings-page'
import { getConnectedAccounts, getUserProfile } from '@/features/community/lib/auth/actions'
import { getSession } from '@/features/community/lib/auth/server'

export default async function Settings() {
  const session = await getSession()
  if (!session?.user) {
    redirect('/')
  }

  const [profile, connectedAccounts] = await Promise.all([getUserProfile(), getConnectedAccounts()])

  return (
    <SettingsPage
      user={session.user}
      currentUsername={profile?.username ?? null}
      currentGithubUrl={profile?.githubUrl ?? null}
      currentXUrl={profile?.xUrl ?? null}
      currentYoutubeUrl={profile?.youtubeUrl ?? null}
      currentEmailNotifications={profile?.emailNotifications ?? true}
      connectedAccounts={connectedAccounts}
    />
  )
}
