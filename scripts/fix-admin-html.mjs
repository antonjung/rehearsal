import { readFileSync, writeFileSync } from 'fs'

// vite-plugin-pwa injects the main app's manifest link + service-worker
// registration into every HTML build entry, including admin.html. That
// manifest's start_url/scope point at the main app, so "Add to Home Screen"
// for admin.html launches the main CueLine app instead of the admin portal.
// Strip both injections here and replace with a tiny inline script that
// builds admin.html its own manifest at runtime (via a blob: URL), so it
// works under whatever origin/base path the site is actually deployed at.
const path = 'dist/admin.html'
let html = readFileSync(path, 'utf-8')

html = html.replace(/<link rel="manifest"[^>]*>/, '')
html = html.replace(/<script id="vite-plugin-pwa:register-sw"[^>]*><\/script>/, '')

const manifestScript = `<script>
(function () {
  var manifest = {
    name: 'CueLine Admin',
    short_name: 'CueLine Admin',
    start_url: new URL('admin.html', document.baseURI).href,
    scope: new URL('.', document.baseURI).href,
    display: 'standalone',
    background_color: '#0f0e17',
    theme_color: '#0f0e17',
    icons: [{ src: new URL('admin-icon.png', document.baseURI).href, sizes: '512x512', type: 'image/png' }],
  }
  var blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' })
  var link = document.createElement('link')
  link.rel = 'manifest'
  link.href = URL.createObjectURL(blob)
  document.head.appendChild(link)
})()
</script>`

html = html.replace('</head>', `  ${manifestScript}\n  </head>`)

writeFileSync(path, html)
console.log('Patched dist/admin.html: removed shared PWA manifest/SW, added standalone admin manifest')
