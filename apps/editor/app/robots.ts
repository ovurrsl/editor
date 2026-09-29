import type { MetadataRoute } from 'next'
import { siteConfig } from './seo'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/viewer/', '/u/'],
        disallow: ['/api/', '/project/', '/settings', '/_next/'],
      },
    ],
    sitemap: `${siteConfig.url}/sitemap.xml`,
    host: siteConfig.url,
  }
}
