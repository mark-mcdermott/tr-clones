# tr-clones

Drum machines built on [boombapbot](https://github.com/mark-mcdermott/boombapbot)'s
core. boombapbot is the product; this is where machines that are not part of
it live and are worked on. There are four: the 606, the 707, the 808, which
was boombapbot's first machine, and the 909.

Nothing here ships in boombapbot, and boombapbot does not know this
repository exists.

## How it fits together

- **`core/`** is boombapbot, as a git submodule pinned to one commit. It
  brings the engine (C++, built natively and to WebAssembly), the editor
  (React) and what every project document shares. This repository uses those
  and changes none of them.
- **`machines/<id>/`** is one machine: its project document, its voices for
  the engine, its panel and its art, what its controls do, and its tests. A
  machine is one folder, and its folder's name is its id. The 808's `engine/`
  folder also holds its own render tool, which plays an 808 project through
  the native engine; the other three use the core's.
  - **606**: seven voices and an accent, level knobs only, 32 patterns in
    two groups, chains and eight tracks.
  - **707**: fifteen sounds on eleven rows, level faders, a display that
    shows the whole pattern, shuffle, two groups of sixteen patterns and
    four tracks.
  - **808**: as it was in boombapbot.
  - **909**: eleven voices with their sound knobs, a tempo display, shuffle,
    two groups of sixteen patterns and four tracks.

  Every voice is synthesised from its knob settings, and every faceplate is
  drawn by a script in the machine's `art/` folder. Where a machine cannot do
  here what the real one does, its settings say so, from the `pending` list
  in its panel manifest.
- **`packages/panel/`** is what the panels share: placing a control on a
  faceplate, knobs, switches and lamps, their styles, the pieces of a panel
  manifest, and the helpers the faceplate drawings are made with.
- **`apps/host/`** is one page that mounts the editor with a machine: the
  one `MACHINE` names when it is built, the 808 when it names none. There is
  no server behind it, so there are no accounts and nothing is saved anywhere
  but in the browser.
- **`e2e/`** is the browser tests: what every machine's tests share, and a
  folder of tests for each machine.
- **`plugins/vst3/`** is a JUCE VST3 instrument that links the same engine
  with the 808's voices. It is a compile spike, not a product; its own
  README says what was and was not verified.
- **`retired/`** holds things no machine uses: generated sample kits for the
  606, 707 and 909 with their generator, and debranded Creative Commons
  photographs of the four machines with their credits. Nothing loads or
  ships them.
- **`scripts/`** builds the engine for the machines here, puts it where a
  machine's page can serve it, runs a command for each machine in turn, and
  measures the engine's load (`pnpm bench`).

## Getting it running

Clone with the submodule, then install:

```bash
git clone --recurse-submodules https://github.com/mark-mcdermott/tr-clones.git
cd tr-clones
pnpm install
```

The engine has to be built once, and again whenever it or a machine's voices
change. It needs CMake, Ninja and a C++20 compiler, and the Emscripten the
core pins:

```bash
pnpm setup:emsdk     # once: installs Emscripten into core/.tools/emsdk
pnpm build:engine    # native engine and its tests, into build/native
pnpm build:wasm      # the same engine as WebAssembly, into build/wasm
```

Then:

```bash
pnpm dev             # the 808, at http://localhost:4321
MACHINE=909 pnpm dev # another machine, at the same address
```

`MACHINE` chooses the machine for `pnpm dev`, `pnpm build`, `pnpm preview`
and `pnpm test:e2e` alike. Each machine's page is built into a folder of its
own, `apps/host/dist/<id>`, so they can stand side by side.

## Checks

In the order CI runs them:

```bash
pnpm kits:check        # the retired kits match their generator
pnpm faceplates:check  # each drawn faceplate matches its generator
pnpm build:engine      # builds the engine for every machine and runs its test suites
pnpm build:wasm
pnpm typecheck
pnpm test:unit         # needs build:engine and build:wasm first
pnpm build:all         # each machine's page, into apps/host/dist/<id>
pnpm test:e2e:all      # Playwright, against each of those builds
```

For one machine, `MACHINE=<id> pnpm build` and `MACHINE=<id> pnpm test:e2e`,
and `pnpm exec vitest run machines/<id>` for its unit tests.
`pnpm test:e2e` needs `pnpm exec playwright install chromium` once. The VST3
spike is built apart from all of this:

```bash
cmake -S plugins/vst3 -B build/vst3 -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build/vst3
ctest --test-dir build/vst3 --output-on-failure
```

`.github/workflows/ci.yml` runs the whole list on every push and pull
request, with the engine also built by Clang and under the sanitizers.

## Moving the core forward

`core/` stays where it is until it is moved on purpose:

```bash
git -C core fetch origin
git -C core checkout <commit>
git add core
```

After that, build the engine again and run the checks: the machines here are
written against the core's engine and editor, and a change there can break
them.

## What has and has not been checked

Run on macOS on Apple silicon: all four machines build and pass the engine's
test suites, their own unit tests and their browser tests in headless
Chromium, on a desktop and a phone profile. The 808 renders the same audio
and MIDI as it did in boombapbot, byte for byte. The VST3 spike builds there
and its self-test passes.

Not checked: how the 606, the 707 and the 909 sound. Their voices were
measured (length, level, brightness) and nobody has listened to them yet,
nor compared any machine here with a real one. What each of the three does
differently from the real machine, and what about it is unverified, is
listed in its settings. Also not checked: Safari, Firefox or a real phone;
the VST3 in any host; and the CI workflow, which has not run on GitHub yet.
