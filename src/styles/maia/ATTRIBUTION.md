# CSS Attribution

This directory (`src/styles/maia/`) contains a mix of original CSS and CSS adapted from third-party sources.

## Starlight (Astro) — adapted files

The following files are **adapted from Starlight** (MIT License):

- **`mdx.css`** ← adapted from Starlight's `markdown.css` (`packages/starlight/style/markdown.css`)
- **`print.css`** ← adapted from Starlight's `print.css` (`packages/starlight/style/print.css`)
- **`layers.css`** ← adapted from Starlight's `layers.css` (`packages/starlight/style/layers.css`)
- **`tokens.css`** (partial) ← the `--maia-sl-*` color token variables are adapted from Starlight's `props.css` (`packages/starlight/style/props.css`)

### Source

- Repository: `https://github.com/withastro/starlight`
- License: MIT License
- Copyright (c) 2023–present Starlight contributors
- Source path: `packages/starlight/style/`

### Modifications

These files have been **modified and extended** for this project's needs:

- Class names: `.sl-markdown-content` → `.maia-mdx`, `starlight.*` layers → `maia.*` layers
- CSS variables: `--sl-*` → `--maia-sl-*` (with `maia-` prefix)
- Adapted for Tailwind CSS v4 integration
- Extended with project-specific tokens and styles
- Mixed with original CSS written for this project

For the full MIT License text, see `THIRD_PARTY_NOTICES.md` in the project root.

## Original CSS

The following files in this directory are **original to this project**:

- `base.css` - base element/reset styles
- `components.css` - app-specific component styles
- `animations.css` - reusable keyframes and animation helpers
- `utils.css` - utility classes and global helpers
- `status-badges.css` - status badge color system
- `tailwind-theme.css` - Tailwind v4 theme variable mappings
- `index.css` - bundle entry point
- `tokens.css` (partial) - all `--maia-*` variables (non-`sl`) are original
