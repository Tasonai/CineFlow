# CineFlow Animation Improvement Plans

Generated via `@improve-animations` based on Emil Kowalski's design engineering philosophy.

## Plan Index

| # | Plan | Severity | Category | Status |
|---|---|---|---|---|
| [001](001-timeline-thumb-scale.md) | Fix Timeline Scrubber Thumb Zero-Scale and Missing Opacity Bridge | HIGH | Physicality & origin | DONE |
| [002](002-timeline-track-gpu-transform.md) | Move Timeline Track Hover Expansion to GPU Compositor | HIGH | Performance | DONE |
| [003](003-toast-enter-exit-transition.md) | Add Smooth Entrance and Exit Transitions for System Toasts | HIGH | Interruptibility & spatial consistency | DONE |
| [004](004-notif-popover-spatial-anchor.md) | Add Spatial Anchor and Entrance Animation to Notification Popover | MEDIUM | Spatial consistency & origin | DONE |
| [005](005-header-search-easing-and-paint-stability.md) | Stabilize Global Search Expansion and Eliminate Input Padding Reflow | MEDIUM | Performance & easing | DONE |
| [006](006-consolidate-motion-tokens.md) | Consolidate Core Motion Tokens into Global CSS Variables | LOW | Tokens & cohesion | DONE |

## Recommended Execution Order

1. **006 — Consolidate Core Motion Tokens**: Establishes global CSS variables `--ease-apple`, `--dur-fast`, etc.
2. **001 & 002 — Scrubber Improvements**: Fixes scrubber thumb scale and track GPU composite transforms in `video-controls-and-person.css`.
3. **004 — Notification Popover**: Adds spatial anchor to header bell drawer.
4. **005 — Header Search Input**: Stabilizes search expansion easing and eliminates input padding reflow.
5. **003 — Toast Transitions**: Implements smooth symmetric entrance and exit for `.toast` across CSS and JS.
