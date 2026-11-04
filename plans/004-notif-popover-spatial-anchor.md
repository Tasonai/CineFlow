# 004 — Add Spatial Anchor and Entrance Animation to Notification Popover

- **Status**: DONE
- **Commit**: 0ca6949
- **Severity**: MEDIUM
- **Category**: Spatial consistency & origin
- **Estimated scope**: 1 file (`public/css/settings-and-episodes.css`), ~18 lines

## Problem

When the notification bell button (`#btn-notif-menu`) in the app header is clicked, `.atv-notif-popover` appears by simply removing `.hidden`:

```css
/* public/css/settings-and-episodes.css:1069 — current */
.atv-notif-popover {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  width: 372px;
  /* zero entrance transition, transform-origin not defined */
}
```

Because there is no entrance animation or specified `transform-origin`, the notification card teleports onto the screen without visual continuity to the bell trigger.

## Target

Add `@keyframes atvNotifPopoverIn` (170ms `cubic-bezier(0.22, 1, 0.36, 1)`) scaling subtly from `scale(0.96) translateY(-4px)` with `transform-origin: top right`:

```css
/* target */
@keyframes atvNotifPopoverIn {
  from {
    opacity: 0;
    transform: scale(0.96) translateY(-4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.atv-notif-popover:not(.hidden) {
  animation: atvNotifPopoverIn 0.17s cubic-bezier(0.22, 1, 0.36, 1);
  transform-origin: top right;
}

@media (max-width: 980px) {
  .atv-notif-popover:not(.hidden) {
    transform-origin: top center;
  }
}
```

## Repo conventions to follow

- Matches `.atv-status-popover` in `public/css/modals-and-search.css:283`.
- Curve: Apple standard `cubic-bezier(0.22, 1, 0.36, 1)` with 170ms budget for medium popovers.

## Steps

1. In `public/css/settings-and-episodes.css`, locate `.atv-notif-popover` (line 1069).
2. Define `@keyframes atvNotifPopoverIn`.
3. Add `.atv-notif-popover:not(.hidden)` with `animation: atvNotifPopoverIn 0.17s cubic-bezier(0.22, 1, 0.36, 1); transform-origin: top right;`.
4. Add mobile media query (`max-width: 980px`) setting `transform-origin: top center;`.

## Boundaries

- Do NOT touch notification list item rendering logic in `public/js/catalog.js` or `public/js/features.js`.
- Do NOT touch `.atv-notif-header` or read actions.

## Verification

- **Mechanical**: Run `python3 run_tests.py`. Verify `test_frontend_integrity.py` passes.
- **Feel check**:
  - Click the bell icon in the top header.
  - Confirm the notification drawer emerges organically from the trigger icon.
- **Done when**: Notification popover opens with a responsive 170ms ease-out anchored to the bell.
