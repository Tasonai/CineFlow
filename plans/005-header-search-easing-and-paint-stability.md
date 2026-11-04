# 005 — Stabilize Global Search Expansion and Eliminate Input Padding Reflow

- **Status**: DONE
- **Commit**: 0ca6949
- **Severity**: MEDIUM
- **Category**: Performance & easing
- **Estimated scope**: 1 file (`public/css/base-and-hero.css`), ~20 lines

## Problem

In `public/css/base-and-hero.css:285` and `313`:

```css
/* public/css/base-and-hero.css:280 — current */
.atv-search {
  position: relative;
  display: flex;
  align-items: center;
  width: 268px;
  max-width: 100%;
  transition: width 0.22s ease;
}

.atv-search:focus-within {
  width: 310px;
}

.atv-search input {
  /* ... */
  transition: background 0.18s ease, padding-right 0.18s ease;
}
```

1. `transition: width 0.22s ease;` uses uncalibrated CSS `ease`, which accelerates late and feels slightly sluggish on focus.
2. `transition: ... padding-right 0.18s ease;` animates internal horizontal padding of the text input while focused. Animating padding on a focused `<input>` forces the browser text shaping and caret layout engine to recalculate line offsets every frame.

## Target

1. Upgrade search box width transition to Apple ease-out curve (`cubic-bezier(0.22, 1, 0.36, 1)`) with a responsive 200ms duration.
2. Remove `padding-right` from the transition on `.atv-search input`, keeping only background transitions:

```css
/* target */
.atv-search {
  position: relative;
  display: flex;
  align-items: center;
  width: 268px;
  max-width: 100%;
  transition: width 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}

.atv-search input {
  width: 100%;
  flex: 1 1 auto;
  min-width: 0;
  padding: 8px 48px 8px 34px;
  border-radius: var(--radius-control);
  background: var(--bg-surface);
  border: none;
  color: var(--text-primary);
  font-size: 13px;
  text-overflow: ellipsis;
  outline: none;
  transition: background 0.18s ease;
}
```

## Repo conventions to follow

- Curve: `cubic-bezier(0.22, 1, 0.36, 1)`.
- Duration: 200ms for UI container expansions.

## Steps

1. In `public/css/base-and-hero.css`, locate `.atv-search` (line 280).
2. Change `transition: width 0.22s ease;` to `transition: width 0.2s cubic-bezier(0.22, 1, 0.36, 1);`.
3. In `.atv-search input` (line 301), change `transition: background 0.18s ease, padding-right 0.18s ease;` to `transition: background 0.18s ease;`.

## Boundaries

- Do NOT change search input placeholder, font size, or clear button positioning.
- Do NOT alter search keyboard shortcut handling (`/` and `Ctrl/Cmd+K`) in `public/app.js`.

## Verification

- **Mechanical**: Run `python3 run_tests.py`. Verify `test_frontend_integrity.py` passes.
- **Feel check**:
  - Focus into the search box in the header.
  - Notice the instant responsiveness of the width expansion.
  - Type query text: caret and characters remain rock-solid with zero text shifting or padding reflow.
- **Done when**: Search container expands smoothly with no text layout reflow.
