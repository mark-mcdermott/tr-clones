# The 808's panel art

The image in this folder is cleared for distribution. A build of the 808
ships the one its panel manifest names in `faceplate.file`. A panel image
needs an entry here, and either a credit in the panel manifest or
`faceplate.original` for artwork drawn in this repository.

### `808.svg`

- **Original work:** drawn for boombapbot by
  [`draw-faceplate.mjs`](draw-faceplate.mjs). Every
  shape in the file is produced by that script. No photograph is traced or
  embedded, so there is nobody to credit, and `808.panel.json` sets
  `faceplate.original` in place of a credit.
- **Where the layout comes from:** the controls the editor makes live (step
  keys and lamps, instrument selector, start/stop, the tempo and fine knobs,
  every knob of the instrument columns, master volume and the voice
  switches) are placed from `808.panel.json`. A live switch is drawn as its
  slot only; the editor draws the lever, and the raised half of the power
  rocker. Those coordinates were measured on the photograph kept in boombapbot's `assets/faceplates/808.webp`.
  The fixed controls and lettering were placed by eye against the same
  photograph, as a record of where things are on the machine.
- **Licence of this file:** the owner's own artwork. No licence has been
  chosen for it.
- **Changing it:** edit the script and run `pnpm faceplates:draw`. Do not edit
  the SVG by hand; `pnpm faceplates:check` fails if the two differ.
- **What a drawing does not settle:** it avoids the photograph's copyright
  and its credit. It says nothing about the manufacturer's rights in the look
  of the machine itself. That needs advice before a public release.
