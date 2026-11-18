import { expect, test } from '@playwright/test';
import {
  DRAFT_KEY,
  downloadBytes,
  exportVia,
  hitCount,
  openEditor,
  openSettings,
  parseMidi,
  parseWav,
  project,
  run,
  selectTrack,
  stepKey,
  stepsOn,
  stop,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test('exports a one-measure WAV loop with audio in it', async ({ page }) => {
  const { tempo } = await project(page);
  const download = await exportVia(page, 'export-wav');
  expect(download.suggestedFilename()).toBe('starter-beat.wav');
  const wav = parseWav(await downloadBytes(download));
  expect(wav.channels).toBe(2);
  expect(wav.sampleRate).toBe(44100);
  expect(wav.bits).toBe(24);
  // Four beats last 240 / bpm seconds, to the frame.
  expect(Math.abs(wav.frames - (44100 * 240) / tempo)).toBeLessThanOrEqual(1);
  expect(wav.peak).toBeGreaterThan(0.1);
  expect(wav.peak).toBeLessThanOrEqual(1);
  expect(wav.rms).toBeGreaterThan(0.01);

  const sixteen = parseWav(await downloadBytes(await exportVia(page, 'export-wav-16')));
  expect(sixteen.bits).toBe(16);
  expect(sixteen.frames).toBe(wav.frames);
  expect(sixteen.rms).toBeCloseTo(wav.rms, 3);
});

test('a chain exports as its patterns one after another', async ({ page }) => {
  const { tempo } = await project(page);
  await stepKey(page, 0).click();
  await stepKey(page, 3).click({ modifiers: ['Shift'] });
  const wav = parseWav(await downloadBytes(await exportVia(page, 'export-wav')));
  expect(Math.abs(wav.frames - (44100 * 960) / tempo)).toBeLessThanOrEqual(1);
  const midi = parseMidi(await downloadBytes(await exportVia(page, 'export-midi')));
  expect(midi.trackEnds).toEqual([7680, 7680]);
  const snapshot = await project(page);
  const hits = [0, 1, 2, 3].reduce((sum, pattern) => sum + hitCount(snapshot, pattern), 0);
  expect(midi.notes.filter((note) => note.on)).toHaveLength(hits);
});

test('exports a MIDI file with tempo and drum notes on channel 10', async ({ page }) => {
  const snapshot = await project(page);
  const download = await exportVia(page, 'export-midi');
  expect(download.suggestedFilename()).toBe('starter-beat.mid');
  const midi = parseMidi(await downloadBytes(download));
  expect(midi.format).toBe(1);
  expect(midi.trackCount).toBe(2);
  expect(midi.ppq).toBe(480);
  expect(midi.tempoMicros).toBe(Math.floor(60_000_000 / snapshot.tempo + 0.5));
  expect(midi.trackEnds).toEqual([1920, 1920]);

  const noteOns = midi.notes.filter((note) => note.on);
  expect(noteOns).toHaveLength(hitCount(snapshot));
  expect(midi.notes).toHaveLength(hitCount(snapshot) * 2);
  expect(midi.notes.every((note) => note.channel === 10)).toBe(true);

  // The bass drum is General MIDI note 36. Its ticks are its steps, and it is
  // louder on the steps the accent track marks.
  const kicks = noteOns.filter((note) => note.note === 36);
  expect(kicks.map((note) => note.tick)).toEqual(stepsOn(snapshot, 'kick').map((index) => index * 120));
  const accents = stepsOn(snapshot, 'accent');
  const loud = Math.max(...kicks.map((note) => note.velocity));
  const soft = Math.min(...kicks.map((note) => note.velocity));
  expect(loud).toBeGreaterThan(soft);
  for (const note of kicks) expect(note.velocity).toBe(accents.includes(note.tick / 120) ? loud : soft);
  // Both hi-hats, on their own notes.
  expect(noteOns.filter((note) => note.note === 42)).toHaveLength(stepsOn(snapshot, 'closed_hat').length);
  expect(noteOns.filter((note) => note.note === 46)).toHaveLength(stepsOn(snapshot, 'open_hat').length);
});

test('exports the project as JSON and imports it back', async ({ page }) => {
  await stepKey(page, 15).click();
  await selectTrack(page, 'cymbal');
  await run(page);
  await stepKey(page, 0).click();
  await stop(page);
  await page.getByTestId('panel-level-toms').focus();
  await page.keyboard.press('PageUp');
  const saved = await project(page);

  const download = await exportVia(page, 'export-project');
  expect(download.suggestedFilename()).toBe('starter-beat.boombapbot.json');
  const bytes = await downloadBytes(download);
  const document = JSON.parse(bytes.toString('utf8'));
  expect(document.format).toBe('boombapbot.project');
  expect(document.schemaVersion).toBe(1);
  expect(document.machine).toBe('606');
  expect(document.patterns).toEqual(saved.patterns);
  expect(document.patterns.map((group: unknown[]) => group.length)).toEqual([16, 16]);
  expect(document.tracks).toHaveLength(8);
  expect(document.mix.levels.toms).toBe(0.95);

  // Change the machine, then import the file to get it back.
  await openSettings(page);
  await page.getByTestId('clear-everything').click();
  expect(hitCount(await project(page))).toBe(0);
  await page.keyboard.press('Escape');
  await page.getByTestId('panel-level-toms').focus();
  await page.keyboard.press('Home');
  await page.getByTestId('import-input').setInputFiles({
    name: 'starter-beat.boombapbot.json',
    mimeType: 'application/json',
    buffer: bytes,
  });
  await expect(page.getByTestId('settings-modal')).toHaveCount(0);
  await expect(page.getByTestId('notice')).toContainText('Imported');
  await expect(page.getByTestId('notice')).not.toContainText('earlier version');
  // Patterns, tracks, knobs and switches all come back; only the time of the change is new.
  const restored = await project(page);
  expect({ ...restored, updatedAt: saved.updatedAt }).toEqual(saved);
  await expect(page.getByTestId('panel-level-toms')).toHaveAttribute('aria-valuenow', '95');

  // Undo brings back what was there before the import.
  await page.keyboard.press('Control+z');
  expect(hitCount(await project(page))).toBe(0);
  expect((await project(page)).mix.levels.toms).toBe(0);
});

test('an invalid import is rejected and the current beat is untouched', async ({ page }) => {
  await page.getByTestId('panel-level-accent').focus();
  await page.keyboard.press('End');
  const before = await project(page);
  const storedBefore = await page.evaluate((key) => localStorage.getItem(key), DRAFT_KEY);
  expect(storedBefore).not.toBeNull();
  const stored = JSON.parse(storedBefore!);

  const invalid = [
    { name: 'notes.txt', buffer: Buffer.from('this is not a project') },
    { name: 'wrong.json', buffer: Buffer.from(JSON.stringify({ format: 'other', schemaVersion: 1 })) },
    { name: 'future.json', buffer: Buffer.from(JSON.stringify({ ...stored, schemaVersion: 2 })) },
    { name: 'another-machine.json', buffer: Buffer.from(JSON.stringify({ format: 'boombapbot.project', schemaVersion: 2 })) },
    { name: 'broken.boombapbot.json', buffer: Buffer.from(JSON.stringify({ ...stored, tempo: 900 })) },
    { name: 'chain.boombapbot.json', buffer: Buffer.from(JSON.stringify({ ...stored, panel: { ...stored.panel, pattern: 2, chainEnd: 9 } })) },
  ];
  for (const file of invalid) {
    await page.getByTestId('import-input').setInputFiles({ ...file, mimeType: 'application/json' });
    const notice = page.getByTestId('notice');
    await expect(notice).toHaveAttribute('data-kind', 'error');
    await expect(notice).toContainText(`${file.name} was not imported`);
    expect(await project(page)).toEqual(before);
  }
  expect(await page.evaluate((key) => localStorage.getItem(key), DRAFT_KEY)).toBe(storedBefore);
});
