# Provenance and notices

The initial capture, waterfall, JSON preview, markup, styles, and regression
tests were adapted from an existing web inspector at source revision
`da56bd1be9cddf20483fa6372cf8010965ed9595`. The source package declares
`MIT OR Apache-2.0`; this distribution offers the same license choice. The copied files
contain no separate copyright headers or third-party notices. Original authors
retain copyright in their contributions. The source repository and its history
are not part of this distribution. The adaptations and additions in this
repository are also offered under `MIT OR Apache-2.0`.

This library has no runtime npm dependencies. The default preview renderer
lazily loads a vendored browser build of highlight.js 11.11.1, including its
language definitions, under the BSD-3-Clause license. Its license is included
at `src/vendor/highlight.LICENSE`. Rebuild with `npm run build:highlighter`.
Other development dependencies are not redistributed in the package. Their licenses remain with their respective
packages: LinkeDOM (ISC), Playwright (Apache-2.0), and Prettier (MIT).

The website's Inferal sponsorship mark is reproduced from the public footer
asset at https://notabenda.org/assets/inferal-mark.svg. It identifies the sponsor
and is separate from the reusable inspector UI.
