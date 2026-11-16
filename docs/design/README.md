# Design reference

Mockup sources exported from the design canvas. One file per screen:

| File | Screen |
|---|---|
| `Main.dc.html` | Play (step grid, macros, keyboard drawer in scale layout) |
| `Sound.dc.html` | Sound (FM algorithm, envelope, describe a sound, keyboard drawer in piano layout) |
| `Perform.dc.html` | Perform (XY pad, quick FX, chord and note pads) |
| `Song.dc.html` | Song (sections, lane overview, jam queue) |
| `Hum.dc.html` | Capture, listening |
| `HumPlace.dc.html` | Capture, fit key, place, harmonize |
| `FX.dc.html` | FX sheet |
| `Desktop.dc.html` | Desktop layout with labeled keyboard |
| `screens/*.png` | Optional screenshots exported from the canvas (add them here) |

How to read them:
- They are a template format for the design tool, not app code. They will not render on their own (they load the tool's runtime).
- The markup inside `<x-dc>` is the layout. Inline `style` values are the exact sizes, colors and spacing to match.
- `{{name}}` holes are filled by `renderVals()` in the script at the bottom of each file. That script shows the sample data and the interactive behavior (selection states, toggles).
- `<sc-for>` repeats an element over a list, `<sc-if>` shows it conditionally.
- Rebuild these as real components; do not try to reuse the files.
