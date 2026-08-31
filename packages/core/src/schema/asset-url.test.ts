import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { ALLOWED_ORIGINS_ENV, AssetUrl } from './asset-url'

function isValid(url: string): boolean {
  return AssetUrl.safeParse(url).success
}

describe('AssetUrl', () => {
  describe('allowed URLs', () => {
    const cases: Array<[string, string]> = [
      ['asset://abc', 'internal asset handle'],
      ['asset://catalog/items/chair-1', 'nested asset handle'],
      ['blob:http://example.com/uuid-1234', 'blob URL with http inner'],
      ['blob:https://example.com/uuid-5678', 'blob URL with https inner'],
      ['https://cdn.example.com/a.glb', 'https CDN URL'],
      ['https://cdn.example.com/models/chair.glb?v=2', 'https URL with query string'],
      ['http://localhost:3000/x', 'http localhost with port'],
      ['http://localhost/x', 'http localhost without port'],
      ['http://127.0.0.1:8080/texture.png', 'http 127.0.0.1 loopback'],
      ['/public/a.glb', 'app-relative path'],
      ['/material/wood1/albedoMap_basecolor.jpg', 'relative path deep'],
      ['data:image/png;base64,AAA', 'inline PNG data URL'],
      ['data:image/jpeg;base64,/9j/', 'inline JPEG data URL'],
      ['data:image/webp;base64,UklGR', 'inline WebP data URL'],
      ['DATA:IMAGE/PNG;base64,AAA', 'uppercase DATA scheme PNG data URL'],
      ['data:IMAGE/PNG;base64,AAA', 'uppercase IMAGE/PNG data URL'],
      ['ASSET://abc', 'uppercase ASSET scheme'],
      ['BLOB:https://example.com/uuid-5678', 'uppercase BLOB scheme'],
    ]
    for (const [url, label] of cases) {
      test(`accepts ${label}: ${url}`, () => {
        expect(isValid(url)).toBe(true)
      })
    }
  })

  describe('rejected URLs', () => {
    const cases: Array<[string, string]> = [
      ['javascript:alert(1)', 'javascript scheme'],
      ['JAVASCRIPT:alert(1)', 'javascript scheme uppercase'],
      ['file:///etc/passwd', 'file scheme'],
      ['file://C:/Windows/System32/config', 'file scheme Windows'],
      ['http://evil.com/', 'non-loopback http'],
      ['http://example.com:3000/x', 'http on non-loopback host'],
      ['http://169.254.169.254/latest/meta-data/', 'http on link-local (cloud metadata)'],
      ['data:image/svg+xml,%3Csvg%3E', 'inline SVG data URL (XSS vector)'],
      ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'base64 SVG data URL (XSS vector)'],
      ['data:image/SVG+XML,%3Csvg%3E', 'uppercase SVG data URL'],
      ['data:image/SVG+XML;base64,PHN2Z3gvbmxvYWQ9YWxlcnQoMSk7+', 'uppercase SVG base64 data URL'],
      ['data:image/Svg+Xml,<svg onload=alert(1)>', 'mixed case SVG data URL'],
      ['data:IMAGE/SVG+XML;base64,PHN2Z248L3N2Zz4=', 'uppercase MIME and SVG data URL'],
      ['DATA:IMAGE/SVG+XML;base64,PHN2Z248L3N2Z24=', 'uppercase DATA scheme SVG data URL'],
      ['data:image/svg+xml;charset=utf-8,<svg><script>alert(1)</script></svg>', 'SVG data URL with charset parameter'],
      ['data:text/html,<script>alert(1)</script>', 'data text/html'],
      ['data:application/javascript,alert(1)', 'data application/javascript'],
      ['data:text/plain,hi', 'data text/plain'],
      ['ftp://a.b.com', 'ftp scheme'],
      ['ws://example.com/', 'websocket scheme'],
      ['vbscript:msgbox', 'vbscript scheme'],
      ['', 'empty string'],
      ['not a url at all', 'non-url string'],
      ['://missing-scheme', 'malformed'],
    ]
    for (const [url, label] of cases) {
      test(`rejects ${label}: ${url}`, () => {
        expect(isValid(url)).toBe(false)
      })
    }
  })

  describe(`env allowlist via ${ALLOWED_ORIGINS_ENV}`, () => {
    const g = globalThis as { process?: { env?: Record<string, string | undefined> } }
    const original = g.process?.env?.[ALLOWED_ORIGINS_ENV]

    beforeEach(() => {
      if (g.process?.env) delete g.process.env[ALLOWED_ORIGINS_ENV]
    })

    afterEach(() => {
      if (!g.process?.env) return
      if (original === undefined) {
        delete g.process.env[ALLOWED_ORIGINS_ENV]
      } else {
        g.process.env[ALLOWED_ORIGINS_ENV] = original
      }
    })

    test('single origin allowlist accepts matching https URL', () => {
      if (!g.process?.env) return // browser-only runtime
      g.process.env[ALLOWED_ORIGINS_ENV] = 'https://cdn.pascal.app'
      expect(isValid('https://cdn.pascal.app/a.glb')).toBe(true)
      expect(isValid('https://cdn.pascal.app/deep/path?q=1')).toBe(true)
    })

    test('single origin allowlist rejects non-matching https URL', () => {
      if (!g.process?.env) return
      g.process.env[ALLOWED_ORIGINS_ENV] = 'https://cdn.pascal.app'
      expect(isValid('https://cdn.other.com/a.glb')).toBe(false)
      expect(isValid('https://attacker.example.com/x')).toBe(false)
    })

    test('multi-origin allowlist accepts any listed origin', () => {
      if (!g.process?.env) return
      g.process.env[ALLOWED_ORIGINS_ENV] = 'https://cdn.pascal.app, https://assets.pascal.app'
      expect(isValid('https://cdn.pascal.app/a.glb')).toBe(true)
      expect(isValid('https://assets.pascal.app/tex.webp')).toBe(true)
      expect(isValid('https://third.example.com/x')).toBe(false)
    })

    test('allowlist ignores trailing / in URL path (origin match only)', () => {
      if (!g.process?.env) return
      g.process.env[ALLOWED_ORIGINS_ENV] = 'https://cdn.pascal.app'
      expect(isValid('https://cdn.pascal.app/')).toBe(true)
      expect(isValid('https://cdn.pascal.app')).toBe(true)
    })

    test('empty allowlist behaves like unset', () => {
      if (!g.process?.env) return
      g.process.env[ALLOWED_ORIGINS_ENV] = ''
      expect(isValid('https://cdn.other.com/a.glb')).toBe(true)
    })

    test('allowlist does not restrict non-https schemes', () => {
      if (!g.process?.env) return
      g.process.env[ALLOWED_ORIGINS_ENV] = 'https://cdn.pascal.app'
      // these should still pass because they match earlier scheme-based branches
      expect(isValid('asset://x')).toBe(true)
      expect(isValid('blob:https://example.com/abc')).toBe(true)
      expect(isValid('data:image/png;base64,AAA')).toBe(true)
      expect(isValid('/public/a.glb')).toBe(true)
      expect(isValid('http://localhost:3000/x')).toBe(true)
    })

    test('allowlist rejects subdomain spoofing', () => {
      if (!g.process?.env) return
      g.process.env[ALLOWED_ORIGINS_ENV] = 'https://cdn.pascal.app'
      expect(isValid('https://cdn.pascal.app.evil.com/x')).toBe(false)
      expect(isValid('https://evil.com/cdn.pascal.app')).toBe(false)
    })

    test('allowlist respects ports', () => {
      if (!g.process?.env) return
      g.process.env[ALLOWED_ORIGINS_ENV] = 'https://cdn.pascal.app:8443'
      expect(isValid('https://cdn.pascal.app:8443/x')).toBe(true)
      expect(isValid('https://cdn.pascal.app/x')).toBe(false)
    })
  })
})
