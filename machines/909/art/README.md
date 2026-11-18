# The 909's panel art

The image in this folder is cleared for distribution. A build of the 909
ships the one its panel manifest names in `faceplate.file`. A panel image
needs an entry here, and either a credit in the panel manifest or
`faceplate.original` for artwork drawn in this repository.

### `909.svg`

- **Original work:** drawn for this repository by
  [`draw-faceplate.mjs`](draw-faceplate.mjs). Every shape in the file is
  produced by that script and the helpers it shares with the other machines'
  drawings (`packages/panel/art/svg.mjs`). No photograph is traced or
  embedded, so there is nobody to credit, and `909.panel.json` sets
  `faceplate.original` in place of a credit.
- **Where the layout comes from:** every control the editor makes live (the
  knobs, the tempo knob, START and STOP, the small keys and their lamps,
  ENTER, the sixteen step keys and the lamp window in each, the lamps of the
  scale chart, the display and the power switch) is placed from
  `909.panel.json`. The editor turns the knobs, lights the lamps, draws the
  display's digits and the raised half of the power rocker; the drawing has
  each of them at rest. The coordinates are a regular grid laid out for this
  drawing, in a space 2000 wide, with the photograph kept in
  `retired/faceplates/909.webp` looked at as a record of where things are on
  the machine. The lettering and the fixed shapes were placed by eye the
  same way.
- **What is not drawn:** a control that does nothing here is not drawn as
  one. The third PATTERN key, the BANK keys, EXT INST, TEMPO MODE, TAPE SYNC,
  the cartridge and the step keys' track-editing words are left off, and the
  bar under the step keys carries the shuffle settings in their place. The
  machine has no power switch on its panel; this one does, because the page
  needs one. The panel manifest's `pending` list says what else differs.
- **Licence of this file:** the owner's own artwork. No licence has been
  chosen for it.
- **Changing it:** edit the script, or the manifest for a live control, and
  run `node machines/909/art/draw-faceplate.mjs`. Do not edit the SVG by
  hand; the same command with `--check` fails if the two differ.
- **What a drawing does not settle:** it avoids the photograph's copyright
  and its credit. It says nothing about the manufacturer's rights in the look
  of the machine itself. That needs advice before a public release.
