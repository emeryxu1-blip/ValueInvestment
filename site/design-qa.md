# Design QA — Centered Full-Cover Hero

## Source visual truth

- Full reported page: `/var/folders/bp/h6q27wjj0bb_9jp1hq5z7np80000gn/T/TemporaryItems/NSIRD_screencaptureui_1LBkGn/Screenshot 2026-08-12 at 14.54.55.png`
- Reported hero detail: `/var/folders/bp/h6q27wjj0bb_9jp1hq5z7np80000gn/T/TemporaryItems/NSIRD_screencaptureui_HhhTAZ/Screenshot 2026-08-12 at 15.00.30.png`
- Canonical illustration asset: `/Users/zhiyangxu/Documents/ValueInvestment/site/public/value-opportunities-buffett-hero.webp`

## Rendered implementation evidence

- Ultra-wide: `/tmp/value-opportunities-hero-qa.BpuaH0/implementation-wide.png`
- Desktop: `/tmp/value-opportunities-hero-qa.BpuaH0/implementation-desktop.png`
- Compact desktop: `/tmp/value-opportunities-hero-qa.BpuaH0/implementation-compact.png`
- Tablet: `/tmp/value-opportunities-hero-qa.BpuaH0/implementation-tablet.png`
- Mobile: `/tmp/value-opportunities-hero-qa.BpuaH0/implementation-mobile.png`
- Full-view before/after: `/tmp/value-opportunities-hero-qa.BpuaH0/comparison-wide-before-after.png`
- Focused hero before/after: `/tmp/value-opportunities-hero-qa.BpuaH0/comparison-hero-focused.png`

## Comparison setup

- The 5120 × 2682 source capture was normalized from 2× density to the exact 2560 × 1341 CSS-pixel implementation viewport.
- The 4416 × 840 hero detail was normalized from 2× density to 2208 × 420 CSS pixels.
- Implementation captures use device scale factor 1 in the in-app browser.
- Light theme, closed filter library, canonical three active filters. The source contains live rows while the local implementation shows its existing handled unavailable-results state; this data-state difference is outside the hero redesign.

## Findings and iteration history

1. **[P1] The illustration was materially cropped.**
   - Evidence: the source asset is 1942 × 810 (2.3975:1), while the reported ultra-wide implementation forced it into a 1500 × 400 (3.75:1) box with `object-fit: cover`. Approximately 36% of the source height was omitted. Fixed-height mobile boxes also removed roughly 28–36% of the source width.
   - Fix: every breakpoint now preserves the intrinsic 1942:810 ratio, uses automatic height and `object-fit: contain`, and keeps the artwork container visible rather than clipping it.
   - Post-fix evidence: at 2560, 2208, 1780, 1440, 1181, 1101, 1100, 1024, 900, 768, 390, and 320 pixels wide, the rendered image ratio remains 2.3975–2.3976, `object-fit` is `contain`, and the image bottom stays inside the hero.

2. **[P1] The cover did not share the page’s centered measure.**
   - Evidence: at 2560px the 1600px shell occupied x=480–2080, but the cover continued to x=2560. It therefore appeared detached from the title, criteria, and results.
   - Fix: the hero is now exactly 100% of the same centered shell. At 2560px the implementation shell is x≈472.5–2072.5 and the illustration is x≈968.5–2068.5, ending four pixels inside the same right edge. The title begins four pixels inside the same left edge.
   - Post-fix evidence: the full-view comparison shows symmetric outer whitespace and a unified title/illustration/content axis.

3. **[P2] A first responsive pass allowed copy and artwork to compete near 1024px.**
   - Evidence: overlaying a 682px-wide illustration at 1024px placed the Coca-Cola bottle behind the headline and left a visually empty band below both elements.
   - Fix: at 1100px and below, the section switches to a simple vertical composition: full-width illustration, eyebrow, title, and intro. The desktop overlay retains a fluid hero height so its divider follows the artwork rather than leaving an empty band.
   - Post-fix evidence: the 1024px, 768px, and 390px captures show the complete illustration before the text with no collision, crop, negative horizontal margin, or overflow.

## Full-view comparison evidence

The before/after composite was inspected as one image. The revised cover no longer owns the viewport edge independently of the page. Buffett’s head, Coca-Cola bottle and logo, hand, tie, jacket, and right shoulder are all represented at the source ratio. The title, cover, criteria, and results now occupy one centered content measure. The hero is quieter and more Apple-like: white space carries the hierarchy, the asset has no border/radius/shadow, and the thin separator aligns with the rest of the page.

## Focused hero comparison evidence

The focused composite makes the two requested changes explicit. The reported state enlarges the portrait by cropping away much of the lower source and sends the image to the viewport edge. The revised state scales the complete illustration into the content shell, keeps the Coca-Cola branding readable, preserves the two-line desktop headline, and gives the text and subject distinct visual zones.

## Required fidelity surfaces

- **Fonts and typography:** passed. Existing system font, optical weights, line heights, tracking, hierarchy, wrapping, and all text remain unchanged.
- **Spacing and layout rhythm:** passed. Desktop art and title share the shell; the compact layout stacks cleanly; divider and following section spacing are consistent.
- **Colors and tokens:** passed. Existing white, graphite, secondary gray, Apple blue, and pale-blue interaction tokens are preserved.
- **Image quality and asset fidelity:** passed. The original 1942 × 810 WebP is rendered directly at its intrinsic ratio. No redraw, replacement, distortion, geometric crop, border, radius, or shadow is introduced.
- **Copy and content:** passed. No hero copy, label name, filter title/formula, action label, table label, status copy, or FAQ text changed.
- **Interaction and accessibility:** passed for the tested browser flow. Native details/summary semantics remain intact, and the hero retains its existing eager load, descriptive alt text, intrinsic dimensions, and non-draggable behavior.

## Responsive and interaction checks

- No page content extends beyond the layout viewport at the tested widths from 320px through 2560px.
- Every tested image rectangle remains horizontally inside the centered shell and vertically inside the hero.
- Browse filters retained exact closed/open/reclosed geometry at desktop: x=1178.266, document y=629.344, 170.234 × 42.
- Browse filters retained exact closed/open/reclosed geometry at mobile: x=10, document y=614.375, 355 × 56.
- Final open/close interaction produced no runtime, unhandled-rejection, console error, or console warning events.

## Production verification

- ESLint, TypeScript, the Cloudflare production build, all 144 tests, and the credential scan passed.
- Preview version `10683b3e-b1a6-46d9-b913-490ecdbc3498` returned HTTP 200 for the page, schema-three snapshot API, and illustration before promotion.
- Production now routes 100% of traffic to `10683b3e-b1a6-46d9-b913-490ecdbc3498`.
- The live page, API, and hero asset return HTTP 200; the snapshot contains schema 3 with 997 rows.
- Production CSS hashes match the uploaded OpenNext assets, and the live illustration hash exactly matches the local source asset.

## Remaining findings

- No actionable P0, P1, or P2 design or interaction finding remains.
- No P3 follow-up is required for the requested hero section.

## Implementation checklist

- [x] Preserve the entire source illustration at every breakpoint.
- [x] Center the hero on the same shell as all following content.
- [x] Remove viewport-edge bleed and fixed-height cover boxes.
- [x] Keep the desktop title and cover visually integrated.
- [x] Stack the complete cover and text before they can collide.
- [x] Preserve every existing label and product string.
- [x] Verify Browse filters after the responsive changes.
- [x] Run the full production release and live verification sequence.

final result: passed
