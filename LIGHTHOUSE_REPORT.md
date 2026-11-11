# Guestora Lighthouse report

Audited the local Guestora site at `http://127.0.0.1:3000/` in Chrome with Lighthouse mobile and desktop emulation.

| Mode | Performance | Accessibility | Best practices | SEO |
| --- | ---: | ---: | ---: | ---: |
| Mobile | 99 | 95* | 100 | 100 |
| Desktop | 100 | 95* | 100 | 100 |

\* The full audits flagged low contrast in muted homepage/footer text. Those text colors were raised, then the mobile and desktop accessibility audits were rerun: both scored **100**, and the color contrast audit passed in both modes. The targeted reruns covered accessibility only, so performance and other category scores above are from the full audit before the contrast-only styling adjustment.

Additional checks: lint and TypeScript checks pass; primary routes returned HTTP 200 locally. The production dependency audit reports no vulnerabilities. The full audit reports five high severity findings in the development lint dependency chain (`braces` → `micromatch` → `fast-glob`); npm only offers a forced fix that downgrades the Next lint configuration to v14, so that breaking change was not applied.

A production build had passed after the authentication and QR changes, but the latest clean rebuild was blocked by Windows `EPERM` while Next.js tried to create a generated folder under `.next/types`; a successful production build on the project machine is still needed to confirm the final generated output.
