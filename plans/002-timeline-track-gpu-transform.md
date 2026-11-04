# 002 — Move Timeline Track Hover Expansion to GPU Compositor

- **Status**: DONE
- **Commit**: 0ca6949
- **Severity**: HIGH
- **Category**: Performance
- **Estimated scope**: 1 file (`public/css/video-controls-and-person.css`), ~12 lines

## Problem

The scrubber track (`.atv-vc-track`) expands in thickness on mouse hover from 4px to 6px by directly animating its `height` property:

```css
/* public/css/video-controls-and-person.css:245 — current */
.atv-vc-track {
  position: relative;
  width: 100%;
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.22);
  overflow: hidden;
  transition: height 0.14s ease;
}

.atv-vc-timeline:hover .atv-vc-track,
.atv-vc-timeline.scrubbing .atv-vc-track {
  height: 6px;
}
```

Animating layout geometry (`height`) directly over a hardware-decoded `<video>` element triggers continuous style invalidation, layout reflow, and repaint passes. In Safari/WebKit and low-power systems, this causes micro-stutter and frame pacing jitter when scrubbing media.

## Target

Keep `height: 4px` constant to prevent any layout reflow. Perform the expansion purely on the GPU compositor using `transform: scaleY(1.5)` with `transform-origin: center`:

```css
/* target */
.atv-vc-track {
  position: relative;
  width: 100%;
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.22);
  overflow: hidden;
  transform: scaleY(1);
  transform-origin: center;
  transition: transform 0.14s cubic-bezier(0.22, 1, 0.36, 1);
}

.atv-vc-timeline:hover .atv-vc-track,
.atv-vc-timeline.scrubbing .atv-vc-track {
  transform: scaleY(1.5);
}
```

## Repo conventions to follow

- Transitions animate `transform` and `opacity` only (AUDIT.md Rule 5).
- Shared easing token: `cubic-bezier(0.22, 1, 0.36, 1)`.

## Steps

1. In `public/css/video-controls-and-person.css`, find `.atv-vc-track` (around line 245).
2. Change `transition: height 0.14s ease;` to `transition: transform 0.14s cubic-bezier(0.22, 1, 0.36, 1);`.
3. Add `transform: scaleY(1);` and `transform-origin: center;` to `.atv-vc-track`.
4. In `.atv-vc-timeline:hover .atv-vc-track, .atv-vc-timeline.scrubbing .atv-vc-track`, replace `height: 6px;` with `transform: scaleY(1.5);`.

## Boundaries

- Do NOT change child buffer fill (`.atv-vc-buffered`) or played fill (`.atv-vc-played`) coordinates.
- Do NOT alter border-radius or container height.

## Verification

- **Mechanical**: Run `python3 run_tests.py`. Verify no regressions.
- **Feel check**:
  - Open DevTools "Rendering" tab &rarr; check "Paint flashing".
  - Hover cursor over the timeline track during video playback.
  - Confirm the timeline bar thickens smoothly without triggering green paint flash rectangles across the player viewport.
- **Done when**: Track expands to 6px visually on hover via GPU compositor with zero layout reflows.
