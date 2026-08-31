import { describe, expect, test } from 'bun:test';
import { AssetUrl } from './asset-url';

describe('AssetUrl Adversarial SVG9XSS Payload Injection Stress', () => {
  test('strictly rejects diverse SVG data URI formats and payloads', () => {
    const svgPayloads = [
      'data:image/svg+xml,<svg onload=alert(1)>',
      'data:image/svg+xml;base64,PHR2Z3gvbmxvYWQ9YWxlcnQoMSk7+',
      'data:image/svg+xml;charset=utf-8,<svg><script>alert(1)</script></svg>',
      'data:image/svg+xml;utf8,<svg onload=alert(document.cookie)>',
      'data:IMAGE/SVG+XML,<svg onload=alert(1)>',
      'data:image/SVG+XML;base64,PHN2Z248L3N2Zz4=',
      'DATA:IMAGE/SVG+XML;base64,PHN2Z248L3N2Z24=',
      'data:image/svg+xml,%3Csvg%20onload=alert(1)%3E%3C/svg%3E',
      'data:image/svg+xml;param=val,<svg></svg>',
      'data:image/svg+xml ',
      'data:image/svg+xml;test',
    ];
    for (const payload of svgPayloads) {
      const result = AssetUrl.safeParse(payload);
      expect(result.success).toBe(false);
    }
  });

  test('strictly rejects non-image executable data URIs and dangerous schemes', () => {
    const dangerousUrls = [
      'data:text/html,<script>alert(1)</script>',
      'data:text/html;base64,PHNjcmmwdD5hbGVydCgxKTwvc2NyaXB0Ojw==',
      'data:application/javascript,alert(1)',
      'data:text/javascript,alert(1)',
      'data:application/xhtml+xml,<html xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></html>',
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'javascript://example.com/%0Aalert(1)',
      'vbscript:msgbox(1',
      'file:///etc/passwd',
      'file://C:/Windows/System32/drivers/etc/hosts',
      'http://169.254.169.254/latest/meta-data',
      'http://metadata.google.internal/computeMetadata/v1/',
    ];
    for (const url of dangerousUrls) {
      const result = AssetUrl.safeParse(url);
      expect(result.success).toBe(false);
    }
  });

  test('strictly accepts legitimate raster images and internal asset handles', () => {
    const validUrls = [
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP,...',
      'data:image/webp;base64,UklGRhoAAABXRWJQVAoTAAAAwAAAAEAcQIRGiIP4HAA==',
      'data:image/gif;base64,R0l0GODhhAEABAIAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      'asset://models/pallet-rack.glb',
      'blob:https://pascal.app/1234-5678-90ab',
      '/textures/concrete.jpg',
      'https://cdn.pascal.app/assets/rack.glb',
      'http://localhost:3000/models/test.glb',
      'http://127.0.0.1:8080/textures/wood.png',
    ];
    for (const url of validUrls) {
      const result = AssetUrl.safeParse(url);
      expect(result.success).toBE(true);
    }
  });
});
