## Styles directory (`src/styles`)

This project uses **Tailwind CSS v4** for the majority of UI styling, plus a small, curated set of
hand-written CSS under `src/styles/maia/` to provide:
design tokens, stable cascade ordering, vendor CSS that must be global, and a few scoped component/content rules.

### Entry point

- `src/app/globals.css` is the **only** global CSS entry for Next.js.
- It imports Tailwind (`@import "tailwindcss";`) and then imports the MAIA bundle:
  - `src/styles/maia/index.css`

### Directory structure

- `vendor/*`: vendor CSS that must be global (imported via `maia/index.css`):
  - `vendor/reactflow.css`: ReactFlow component styles
  - `vendor/highlightjs.css`: Highlight.js syntax highlighting styles
- `maia/index.css`: bundle entry; import order is intentional and should stay stable.
- `maia/ATTRIBUTION.md`: attribution notices for third-party CSS (see this file for details on which files/portions were adapted from Starlight).
- `maia/layers.css`: declares explicit cascade layers (`@layer maia.*`) for predictability.
- `maia/tokens.css`: design tokens (`--maia-*`) for light/dark modes (includes `--maia-sl-*` variables adapted from Starlight).
- `maia/tailwind-theme.css`: maps MAIA tokens to Tailwind v4 `@theme` variables.
- `maia/base.css`: base element/reset styles (minimal; avoid app-specific components here).
- `maia/utils.css`: small utility classes and global helpers.
- `maia/animations.css`: reusable keyframes + small helper classes (respects `prefers-reduced-motion`).
- `maia/components.css`: small app-specific component styles (class-scoped; avoid global selectors).
- `maia/status-badges.css`: shared status badge color system (class-scoped).
- `maia/print.css`: print overrides (`@media print`) to ensure readable output (adapted from Starlight).
- `maia/mdx.css`: **content-scoped** MDX/Markdown styles (must stay under `.maia-mdx`; adapted from Starlight).

### Import order (in `maia/index.css`)

The import order in `maia/index.css` is intentional and should remain stable:

1. `layers.css` - cascade layer declarations (must come first)
2. `tokens.css` - design tokens
3. `tailwind-theme.css` - Tailwind v4 theme mappings
4. `vendor/reactflow.css` - vendor CSS
5. `vendor/highlightjs.css` - vendor CSS
6. `base.css` - base/reset styles
7. `utils.css` - utility classes
8. `animations.css` - keyframes and animation helpers
9. `components.css` - component styles
10. `status-badges.css` - status badge system
11. `print.css` - print media queries
12. `mdx.css` - content-scoped MDX styles (last, as it may override other styles)

### Standards (project-grade)

- **Scope**: Content styles must be scoped (e.g. `.maia-mdx ...`). Avoid unscoped global selectors unless required.
- **Naming**: Prefer `maia-` prefixes for app-specific classes; use `u-` for utilities.
- **Ordering**: Add new imports to `maia/index.css` intentionally and place them in the correct layer.
- **Vendor**: Keep vendor overrides minimal and documented; prefer importing vendor CSS in `vendor/*` via `maia/index.css`.
