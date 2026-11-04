# 003 — Add Smooth Entrance and Exit Transitions for System Toasts

- **Status**: DONE
- **Commit**: 0ca6949
- **Severity**: HIGH
- **Category**: Interruptibility & spatial consistency
- **Estimated scope**: 2 files (`public/css/settings-and-episodes.css`, `public/js/utils.js`), ~35 lines

## Problem

Toasts (`.toast`) in CineFlow currently mount and unmount with zero transition:

```javascript
/* public/js/utils.js:560 — current */
export function showToast(message, options = {}) {
  // ...
  container.appendChild(toast);
  setTimeout(() => toast.remove(), durationMs);
}
```

```css
/* public/css/settings-and-episodes.css:141 — current */
.toast {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  /* zero animation or transition */
}
```

When a user triggers an action (e.g. copying LAN link, profile switched, stream cached), the toast card abruptly pops into the bottom of the screen with no spatial bridge, and disappears mid-blink when the timeout expires.

## Target

1. Enter via `@keyframes atvToastIn` (200ms `cubic-bezier(0.22, 1, 0.36, 1)`) moving from `translateY(12px) scale(0.96)` to settled position with `opacity: 0` &rarr; `1`.
2. Exit symmetrically: when timeout expires or user closes, add `.toast-hiding` (160ms `ease-in`) fading to `opacity: 0; transform: translateY(8px) scale(0.97)` before removing the DOM node:

```css
/* target: public/css/settings-and-episodes.css */
@keyframes atvToastIn {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.toast {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 12px;
  max-width: min(560px, calc(100vw - 28px));
  padding: 10px 16px;
  border-radius: var(--radius-card);
  background: var(--bg-surface);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  border: 1px solid rgba(255, 255, 255, 0.09);
  color: #ffffff;
  font-size: 13px;
  font-weight: 500;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.68);
  pointer-events: auto;
  animation: atvToastIn 0.2s cubic-bezier(0.22, 1, 0.36, 1);
  transition: opacity 0.16s ease-in, transform 0.16s ease-in;
}

.toast.toast-hiding {
  opacity: 0 !important;
  transform: translateY(8px) scale(0.97) !important;
  pointer-events: none !important;
}
```

```javascript
/* target: public/js/utils.js */
const dismissToast = (node) => {
  if (!node || node._isDismissing) return;
  node._isDismissing = true;
  node.classList.add("toast-hiding");
  setTimeout(() => {
    try { node.remove(); } catch (_) {}
  }, 160);
};

// In showToast:
setTimeout(() => dismissToast(toast), durationMs);
```

## Repo conventions to follow

- Toast container lives in `#toast-container` with safe-area padding.
- `prefers-reduced-motion: reduce` in `public/css/video-controls-and-person.css:2199` automatically scales duration to 0.01ms.

## Steps

1. In `public/css/settings-and-episodes.css` line 140, add `@keyframes atvToastIn` and apply `animation: atvToastIn 0.2s cubic-bezier(0.22, 1, 0.36, 1); transition: opacity 0.16s ease-in, transform 0.16s ease-in;` to `.toast`.
2. Add `.toast.toast-hiding` styles with `opacity: 0 !important; transform: translateY(8px) scale(0.97) !important;`.
3. In `public/js/utils.js` line 575, update `showToast`: wrap `toast.remove()` in a 160ms exit transition helper `dismissToast(toast)` both on button action click and on timeout.

## Boundaries

- Do NOT change toast text content, styles, or timeout durations (3800ms default, 7500ms action).
- Do NOT alter `#toast-container` positioning or mini-player shift classes.

## Verification

- **Mechanical**: Run `python3 run_tests.py`. Verify `test_frontend_integrity.py` and `test_server_live.py` pass.
- **Feel check**:
  - In CineFlow, click "Скопировать ссылку" or switch profile to trigger a toast.
  - Confirm the toast slides gently upward and settles into position.
  - When the toast dismisses, verify it dissolves downward rather than blinking out of existence.
- **Done when**: Toasts enter and exit with symmetric, non-jarring vertical opacity transitions.
