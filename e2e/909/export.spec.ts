import { expect, test } from '@playwright/test';
import {
  DRAFT_KEY,
  EMPTY_PATTERN,
  downloadBytes,
  exportVia,
  hitCount,
  key,
  openEditor,
  openSettings,
  parseMidi,
  parseWav,
  patternOf,
  project,
  start,
  stepKey,
  stepsOn,
  stop,
  writePattern,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test('exports the selected pattern as a one-measure WAV loop with audio in it', async ({ page }) => {
  const { tempo } = await project(page);
  const download = await exportVia(page, 'export-wav');
  expect(download.suggestedFilename()).toBe('starter-beat.wav');
  const wav = parseWav(await downloadBytes(download));
  expect(wav.channels).toBe(2);
  expect(wav.sampleRate).toBe(44100);
  expect(wav.bits).toBe(24);
  // Four beats last 240 / tempo seconds, to the frame.
  expect(Math.abs(wav.frames - (44100 * 240) / tempo)).toBeLessThanOrEqual(1);
  expect(wav.peak).toBeGreaterThan(0.1);
  expect(wav.peak).toBeLessThanOrEqual(1);
  expect(wav.rms).toBeGreaterThan(0.01);

  const sixteen = parseWav(await downloadBytes(await exportVia(page, 'export-wav-16')));
  expect(sixteen.bits).toBe(16);
  expect(sixteen.frames).toBe(wav.frames);
  expect(sixteen.rms).toBeCloseTo(wav.rms, 3);
});

test('exports a MIDI file with tempo and drum notes on channel 10', async ({ page }) => {
  const snapshot = await project(page);
  const pattern = patternOf(snapshot);
  const download = await exportVia(page, 'export-midi');
  expect(download.suggestedFilename()).toBe('starter-beat.mid');
  const midi = parseMidi(await downloadBytes(download));
  expect(midi.format).toBe(1);
  expect(midi.trackCount).toBe(2);
  expect(midi.ppq).toBe(480);
  expect(midi.tempoMicros).toBe(Math.floor(60_000_000 / snapshot.tempo + 0.5));
  expect(midi.trackEnds).toEqual([1920, 1920]);

  const noteOns = midi.notes.filter((note) => note.on);
  expect(noteOns).toHaveLength(hitCount(pattern));
  expect(midi.notes).toHaveLength(hitCount(pattern) * 2);
  expect(midi.notes.every((note) => note.channel === 10)).toBe(true);

  // The closed hi-hat is General MIDI note 42. Its ticks are its steps, and
  // it is louder on the steps the total accent marks.
  const hats = noteOns.filter((note) => note.note === 42);
  expect(hats.map((note) => note.tick)).toEqual(stepsOn(pattern, 'closed_hat').map((index) => index * 120));
  const accents = stepsOn(pattern, 'accent');
  const loud = Math.max(...hats.map((note) => note.velocity));
  const soft = Math.min(...hats.map((note) => note.velocity));
  expect(loud).toBeGreaterThan(soft);
  for (const note of hats) expect(note.velocity).toBe(accents.includes(note.tick / 120) ? loud : soft);
  // Rim shot 37, hand clap 39, open hi-hat 46: every instrument has a note of its own.
  expect(noteOns.filter((note) => note.note === 46).map((note) => note.tick)).toEqual(stepsOn(pattern, 'open_hat').map((index) => index * 120));
});

test('exports a chain as its patterns one after another, and a track once through', async ({ page }) => {
  const snapshot = await project(page);
  await key(page, 'shift').click();
  await stepKey(page, 1).click();
  const chain = parseMidi(await downloadBytes(await exportVia(page, 'export-midi')));
  expect(chain.trackEnds).toEqual([3840, 3840]);
  expect(chain.notes.filter((note) => note.on)).toHaveLength(hitCount(patternOf(snapshot, 0)) + hitCount(patternOf(snapshot, 1)));
  await page.keyboard.press('Escape');

  await page.getByTestId('panel-track-0').click();
  const track = parseMidi(await downloadBytes(await exportVia(page, 'export-midi')));
  const measures = snapshot.patternTracks[0]!.measures;
  expect(track.trackEnds).toEqual([measures.length * 1920, measures.length * 1920]);
  expect(track.notes.filter((note) => note.on)).toHaveLength(
    measures.reduce((sum, number) => sum + hitCount(patternOf(snapshot, number, 0)), 0),
  );
  await page.keyboard.press('Escape');

  // An empty track has nothing to export, and says so.
  await page.getByTestId('panel-track-3').click();
  await openSettings(page);
  await page.getByTestId('export-menu').click();
  await page.getByTestId('export-midi').click();
  await expect(page.getByTestId('notice')).toContainText('The MIDI export failed: track 4 is empty.');
});

test('exports the project as JSON and imports it back', async ({ page }) => {
  await writePattern(page, EMPTY_PATTERN);
  await start(page);
  await stepKey(page, 0).click();
  await stop(page);
  await page.getByTestId('panel-knob-bass_drum_attack').focus();
  await page.keyboard.press('PageUp');
  const saved = await project(page);

  const download = await exportVia(page, 'export-project');
  expect(download.suggestedFilename()).toBe('starter-beat.boombapbot.json');
  const bytes = await downloadBytes(download);
  const document = JSON.parse(bytes.toString('utf8'));
  expect(document).toMatchObject({ format: 'boombapbot.project', schemaVersion: 1, machine: '909' });
  expect(document.patterns).toEqual(saved.patterns);
  expect(document.patterns).toHaveLength(2);
  expect(document.patterns[0]).toHaveLength(16);
  expect(document.patternTracks).toHaveLength(4);
  expect(document.knobs.bass_drum_attack).toBe(0.7);

  // Change the machine, then import the file to get it back.
  await openSettings(page);
  await page.getByTestId('clear-everything').click();
  await page.keyboard.press('Escape');
  await page.getByTestId('panel-knob-bass_drum_attack').focus();
  await page.keyboard.press('Home');
  await page.getByTestId('import-input').setInputFiles({
    name: 'starter-beat.boombapbot.json',
    mimeType: 'application/json',
    buffer: bytes,
  });
  await expect(page.getByTestId('settings-modal')).toHaveCount(0);
  await expect(page.getByTestId('notice')).toContainText('Imported');
  await expect(page.getByTestId('notice')).not.toContainText('earlier version');
  // Patterns, tracks, knobs and the panel all come back; only the time of the change is new.
  const restored = await project(page);
  expect({ ...restored, updatedAt: saved.updatedAt }).toEqual(saved);
  await expect(page.getByTestId('panel-knob-bass_drum_attack')).toHaveAttribute('aria-valuenow', '70');

  // Undo brings back what was there before the import.
  await page.keyboard.press('Control+z');
  expect((await project(page)).patterns.flat().every((pattern) => hitCount(pattern) === 0)).toBe(true);
  expect((await project(page)).knobs.bass_drum_attack).toBe(0);
});

test('an invalid import is rejected and the current beat is untouched', async ({ page }) => {
  await page.getByTestId('panel-knob-ride_tune').focus();
  await page.keyboard.press('PageUp');
  const before = await project(page);
  const storedBefore = await page.evaluate((draft) => localStorage.getItem(draft), DRAFT_KEY);
  expect(storedBefore).not.toBeNull();

  const invalid = [
    { name: 'notes.txt', buffer: Buffer.from('this is not a project') },
    { name: 'wrong.json', buffer: Buffer.from(JSON.stringify({ format: 'other', schemaVersion: 1, machine: '909' })) },
    { name: 'future.json', buffer: Buffer.from(JSON.stringify({ format: 'boombapbot.project', schemaVersion: 2, machine: '909' })) },
    { name: 'another-machine.json', buffer: Buffer.from(JSON.stringify({ format: 'boombapbot.project', schemaVersion: 2 })) },
    { name: 'broken.boombapbot.json', buffer: Buffer.from(JSON.stringify({ ...JSON.parse(storedBefore!), tempo: 900 })) },
  ];
  for (const file of invalid) {
    await page.getByTestId('import-input').setInputFiles({ ...file, mimeType: 'application/json' });
    const notice = page.getByTestId('notice');
    await expect(notice).toHaveAttribute('data-kind', 'error');
    await expect(notice).toContainText(`${file.name} was not imported`);
    expect(await project(page)).toEqual(before);
  }
  expect(await page.evaluate((draft) => localStorage.getItem(draft), DRAFT_KEY)).toBe(storedBefore);
});
