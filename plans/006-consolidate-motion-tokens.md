# 006 — Consolidate Core Motion Tokens into Global CSS Variables

- **Status**: DONE
- **Commit**: 0ca6949
- **Severity**: LOW
- **Category**: Tokens & cohesion
- **Estimated scope**: 1 file (`public/css/base-and-hero.css`), ~15 lines

## Problem

Curves like `cubic-bezier(0.22, 1, 0.36, 1)` and durations like `0.16s`, `0.18s`, `0.2s` are written directly as hardcoded values in stylesheets across the application rather than referencing shared tokens in `:root`:

```css
/* public/css/base-and-hero.css:1 — current :root tokens */
:root {
  --bg-canvas: #0a0a0c;
  --bg-elevated: #141416;
  /* ... color, radius and z-index tokens, but NO motion tokens ... */
}
```

This fragmentation makes future animation tuning difficult and invites drift (e.g. someone using bare `ease` or slightly different curve values).

## Target

Declare standard Apple TV motion tokens in `:root` in `public/css/base-and-hero.css`:

```css
/* target */
:root {
  /* Motion & Easing Tokens */
  --ease-apple: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-smooth: cubic-bezier(0.2, 0.85, 0.3, 1);
  --dur-fast: 140ms;
  --dur-normal: 180ms;
  --dur-popover: 170ms;
}
```

## Repo conventions to follow

- `:root` variable definitions in `public/css/base-and-hero.css` line 1-30.

## Steps

1. Open `public/css/base-and-hero.css`.
2. Inside `:root { ... }`, add the 5 canonical motion tokens.

## Boundaries

- Do NOT rename existing color, radius, or z-index variables.

## Verification

- **Mechanical**: Run `python3 run_tests.py` to ensure all tests pass.
- **Done when**: Motion tokens are globally accessible across all CSS stylesheets.
