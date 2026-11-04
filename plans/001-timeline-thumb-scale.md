# 001 — Fix Timeline Scrubber Thumb Zero-Scale and Missing Opacity Bridge

- **Status**: DONE
- **Commit**: 0ca6949
- **Severity**: HIGH
- **Category**: Physicality & origin
- **Estimated scope**: 1 file (`public/css/video-controls-and-person.css`), ~15 lines

## Problem

The scrubber thumb pip (`.atv-vc-thumb`) in the video controls bar collapses to `scale(0)` when the mouse leaves the timeline track:

```css
/* public/css/video-controls-and-person.css:280 — current */
.atv-vc-thumb {
  position: absolute;
  top: 50%;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.65);
  transform: translate(-50%, -50%) scale(0);
  transition: transform 0.14s ease;
  pointer-events: none;
}

.atv-vc-timeline:hover .atv-vc-thumb,
.atv-vc-timeline.scrubbing .atv-vc-thumb {
  transform: translate(-50%, -50%) scale(1);
}
```

Collapsing into a mathematical zero point (`scale(0)`) violates real-world physical behavior (Emil Kowalski AUDIT.md rule: "Never scale(0) — nothing in the real world appears from nothing"). Furthermore, lacking an opacity transition causes the white circle to shrink into a visible pixel dot before abruptly disappearing.

## Target

The scrubber thumb should shrink to `scale(0.68)` while fading out to `opacity: 0`, and smoothly expand back to `scale(1)` with `opacity: 1` upon hover or drag using the Apple ease-out curve (`cubic-bezier(0.22, 1, 0.36, 1)`):

```css
/* target */
.atv-vc-thumb {
  position: absolute;
  top: 50%;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.65);
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.68);
  transition: opacity 0.14s ease, transform 0.14s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.atv-vc-timeline:hover .atv-vc-thumb,
.atv-vc-timeline.scrubbing .atv-vc-thumb {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
}
```

## Repo conventions to follow

- Animation curves follow Apple TV motion tokens: `cubic-bezier(0.22, 1, 0.36, 1)`.
- Scrubber thumb hover state is keyed to `.atv-vc-timeline:hover` and `.atv-vc-timeline.scrubbing`.
- Exemplar: `.atv-action-pill` press feedback at `public/css/catalog-and-player-layout.css:735`.

## Steps

1. Open `public/css/video-controls-and-person.css` at line 280.
2. Replace `transform: translate(-50%, -50%) scale(0);` with:
   `opacity: 0;`
   `transform: translate(-50%, -50%) scale(0.68);`
3. Update `transition: transform 0.14s ease;` to:
   `transition: opacity 0.14s ease, transform 0.14s cubic-bezier(0.22, 1, 0.36, 1);`
4. Update `.atv-vc-timeline:hover .atv-vc-thumb` rule to set `opacity: 1; transform: translate(-50%, -50%) scale(1);`.

## Boundaries

- Do NOT touch scrubber drag calculation logic in `public/js/player.js`.
- Do NOT alter thumb size (13px) or border radius (50%).
- Do NOT touch `.atv-vc-played` or `.atv-vc-buffered`.

## Verification

- **Mechanical**: Run `python3 run_tests.py` and ensure all tests pass.
- **Feel check**:
  - Open any video in CineFlow player modal.
  - Hover cursor over the bottom timeline scrubber track.
  - The white circle should smoothly appear at the playhead position without popping.
  - Move mouse away from the timeline. The thumb should gracefully dissolve and shrink slightly, never turning into a hard pinprick pixel.
  - In DevTools Animation panel at 10% speed, confirm opacity and transform finish synchronously at 140ms.
- **Done when**: Scrubber thumb enters and exits via combined opacity + scale(0.68 &rarr; 1.0) with zero visual glitches.
