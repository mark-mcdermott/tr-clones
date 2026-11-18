# The 707's panel art

The image in this folder is cleared for distribution. A build of the 707
ships the one its panel manifest names in `faceplate.file`. A panel image
needs an entry here, and either a credit in the panel manifest or
`faceplate.original` for artwork drawn in this repository.

### `707.svg`

- **Original work:** drawn for this repository by
  [`draw-faceplate.mjs`](draw-faceplate.mjs). Every shape in the file is
  produced by that script and the helpers it shares with the other machines'
  drawings (`packages/panel/art/svg.mjs`). No photograph is traced or
  embedded, so there is nobody to credit, and `707.panel.json` sets
  `faceplate.original` in place of a credit.
- **Where the layout comes from:** the controls the editor makes live (the
  power switch, the glass of the display, the twelve faders, the tempo knob,
  start and stop, SHIFT, ENTER, the small keys and the four group keys with
  their lamps, the lamps of the scale chart, and the sixteen step keys with
  theirs) are placed from `707.panel.json`. A fader is drawn as its slot and
  the power switch as its slot; the editor draws the caps and the lever,
  lights the lamps, and draws everything the display shows. Where things are
  was taken by eye from the photograph kept in `retired/faceplates/707.webp`,
  as a record of the machine's layout, and then made regular: even spacing
  for the faders and the keys, and a display glass larger than the machine's
  so that its grid can be read on a screen. The fixed lettering was placed
  the same way.
- **What it leaves out:** the maker's name and the product name, the
  cartridge and its lamp, and the lettering of what the panel does not do
  (flam, the guide click, MIDI channel, sync mode, and saving to cartridge).
  The numbers under the step keys are lettered though they do nothing here;
  the panel manifest's `pending` list says so. The bay beside the display is
  drawn with its lid down. The power switch is on the machine's back; here
  it is drawn on the panel, because the panel has to have one.
- **Licence of this file:** the owner's own artwork. No licence has been
  chosen for it.
- **Changing it:** edit the script, or the manifest for anything live, and
  run `node machines/707/art/draw-faceplate.mjs`. Do not edit the SVG by
  hand; the same command with `--check` fails if the two differ.
- **What a drawing does not settle:** it avoids the photograph's copyright
  and its credit. It says nothing about the manufacturer's rights in the look
  of the machine itself. That needs advice before a public release.
