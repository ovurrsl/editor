import type { Metadata } from 'next'
import CommunityHub from '@/features/community/components/community-hub'
import { UsernameGate } from '@/features/community/components/username-gate'
import { siteConfig } from './seo'

// Site-wide metadata lives here rather than in the root layout so that file
// stays identical to upstream.
export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: 'Community Projects',
  description:
    'Create and share 3D home projects with Pascal Editor, the open-source building editor.',
  applicationName: siteConfig.name,
  keywords: [...siteConfig.keywords],
  openGraph: {
    title: siteConfig.name,
    description: siteConfig.description,
    url: siteConfig.url,
    siteName: siteConfig.name,
    images: [{ url: siteConfig.ogImage, alt: 'Pascal Editor' }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: siteConfig.name,
    description: siteConfig.description,
    creator: siteConfig.twitterHandle,
    images: [siteConfig.ogImage],
  },
}

export default function Home() {
  return (
    <UsernameGate>
      <CommunityHub />
    </UsernameGate>
  )
}
