# The 606's panel art

The image in this folder is cleared for distribution. A build of the 606
ships the one its panel manifest names in `faceplate.file`. A panel image
needs an entry here, and either a credit in the panel manifest or
`faceplate.original` for artwork drawn in this repository.

### `606.svg`

- **Original work:** drawn for this repository by
  [`draw-faceplate.mjs`](draw-faceplate.mjs). Every shape in the file is
  produced by that script and the helpers it shares with the other
  machines' drawings (`packages/panel/art/svg.mjs`). No photograph is
  traced or embedded, so there is nobody to credit, and `606.panel.json`
  sets `faceplate.original` in place of a credit.
- **Where the layout comes from:** the controls the editor makes live (the
  six level knobs, tempo and volume, the instrument and mode selector dials
  and the lettering round them, the scale switch, the step keys and their
  lamps, RUN/STOP, CLEAR, FUNCTION, TAP, the pattern group button and the
  run and group lamps) are placed from `606.panel.json`. The scale switch
  is drawn as its slot only; the editor draws the lever, and lights every
  lamp. Those coordinates were measured by eye on the photograph kept in
  `retired/faceplates/606.webp`, which is 2000 pixels wide like the
  drawing. The fixed lettering was placed by eye against the same
  photograph, as a record of where things are on the machine.
- **What is left off:** the maker's name and the product name, and the
  lettering of what this machine does not do: the segno and D.S. marks,
  the bar-number keys past 0, STEP RESET and the battery check.
- **What is lettered and is not here:** the legends along the top edge
  point at sockets on the back of the machine. This one has no back. They
  are lettering only.
- **Licence of this file:** the owner's own artwork. No licence has been
  chosen for it.
- **Changing it:** edit the script, or the manifest for anything live, and
  run `node machines/606/art/draw-faceplate.mjs`. Do not edit the SVG by
  hand; the same command with `--check` fails if the two differ.
- **What a drawing does not settle:** it avoids the photograph's copyright
  and its credit. It says nothing about the manufacturer's rights in the look
  of the machine itself. That needs advice before a public release.
