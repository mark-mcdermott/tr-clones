import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
  DRAFT_KEY,
  LEGACY_FIXTURE,
  bpmOf,
  downloadBytes,
  exportVia,
  hitCount,
  openEditor,
  openSettings,
  parseMidi,
  parseWav,
  project,
  selectTrack,
  stepButton,
  stepsOn,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test('exports a one-measure WAV loop with audio in it', async ({ page }) => {
  const bpm = bpmOf(await project(page));
  const download = await exportVia(page, 'export-wav');
  expect(download.suggestedFilename()).toBe('starter-beat.wav');
  const wav = parseWav(await downloadBytes(download));
  expect(wav.channels).toBe(2);
  expect(wav.sampleRate).toBe(44100);
  expect(wav.bits).toBe(24);
  // Four beats last 240 / bpm seconds, to the frame.
  expect(Math.abs(wav.frames - (44100 * 240) / bpm)).toBeLessThanOrEqual(1);
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
  const download = await exportVia(page, 'export-midi');
  expect(download.suggestedFilename()).toBe('starter-beat.mid');
  const midi = parseMidi(await downloadBytes(download));
  expect(midi.format).toBe(1);
  expect(midi.trackCount).toBe(2);
  expect(midi.ppq).toBe(480);
  expect(midi.tempoMicros).toBe(Math.floor(60_000_000 / bpmOf(snapshot) + 0.5));
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
  for (const note of kicks) {
    expect(note.velocity).toBe(accents.includes(note.tick / 120) ? loud : soft);
  }
});

test('the MIDI file names the sound a switched column plays', async ({ page }) => {
  const snapshot = await project(page);
  const toms = stepsOn(snapshot, 'low_tom');
  expect(toms.length).toBeGreaterThan(0);
  await page.getByTestId('panel-switch-low_tom').click();
  const midi = parseMidi(await downloadBytes(await exportVia(page, 'export-midi')));
  const noteOns = midi.notes.filter((note) => note.on);
  // General MIDI: 45 is the low tom, 64 the low conga.
  expect(noteOns.filter((note) => note.note === 45)).toHaveLength(0);
  expect(noteOns.filter((note) => note.note === 64).map((note) => note.tick)).toEqual(toms.map((index) => index * 120));
});

test('exports the project as JSON and imports it back', async ({ page }) => {
  await selectTrack(page, 'cymbal');
  await stepButton(page, 0).click();
  await page.getByTestId('panel-knob-kick-tone').focus();
  await page.keyboard.press('PageUp');
  const saved = await project(page);

  const download = await exportVia(page, 'export-project');
  expect(download.suggestedFilename()).toBe('starter-beat.boombapbot.json');
  const bytes = await downloadBytes(download);
  const document = JSON.parse(bytes.toString('utf8'));
  expect(document.format).toBe('boombapbot.project');
  expect(document.schemaVersion).toBe(2);
  expect(document.rhythms).toEqual(saved.rhythms);
  expect(document.rhythms).toHaveLength(16);
  expect(document.rhythmTracks).toHaveLength(12);
  expect(document.sound.knobs.kick.tone).toBe(0.7);

  // Change the machine, then import the file to get it back.
  await openSettings(page);
  await page.getByTestId('clear').click();
  expect(hitCount(await project(page))).toBe(0);
  await page.keyboard.press('Escape');
  await page.getByTestId('panel-knob-kick-tone').focus();
  await page.keyboard.press('Home');
  await page.getByTestId('import-input').setInputFiles({
    name: 'starter-beat.boombapbot.json',
    mimeType: 'application/json',
    buffer: bytes,
  });
  await expect(page.getByTestId('settings-modal')).toHaveCount(0);
  await expect(page.getByTestId('notice')).toContainText('Imported');
  await expect(page.getByTestId('notice')).not.toContainText('earlier version');
  // Rhythms, knobs and switches all come back; only the time of the change is new.
  const restored = await project(page);
  expect({ ...restored, updatedAt: saved.updatedAt }).toEqual(saved);
  await expect(page.getByTestId('panel-knob-kick-tone')).toHaveAttribute('aria-valuenow', '70');

  // Undo brings back what was there before the import.
  await page.keyboard.press('Control+z');
  expect(hitCount(await project(page))).toBe(0);
  expect((await project(page)).sound.knobs.kick!.tone).toBe(0);
});

test('a project file from the earlier version is brought up to date on import', async ({ page }) => {
  const legacy = readFileSync(LEGACY_FIXTURE);
  await page.getByTestId('import-input').setInputFiles({
    name: 'old-beat.boombapbot.json',
    mimeType: 'application/json',
    buffer: legacy,
  });
  const notice = page.getByTestId('notice');
  await expect(notice).toHaveAttribute('data-kind', 'info');
  await expect(notice).toContainText('earlier version');
  await expect(notice.locator('li')).not.toHaveCount(0);
  const snapshot = await project(page);
  expect(snapshot.schemaVersion).toBe(2);
  expect(hitCount(snapshot)).toBe(22);
  // Hits that were at accent velocity became steps of the accent track.
  expect(stepsOn(snapshot, 'accent').length).toBeGreaterThan(0);
});

test('an invalid import is rejected and the current beat is untouched', async ({ page }) => {
  await selectTrack(page, 'cymbal');
  await stepButton(page, 3).click();
  const before = await project(page);
  const storedBefore = await page.evaluate((key) => localStorage.getItem(key), DRAFT_KEY);
  expect(storedBefore).not.toBeNull();

  const invalid = [
    { name: 'notes.txt', buffer: Buffer.from('this is not a project') },
    { name: 'wrong.json', buffer: Buffer.from(JSON.stringify({ format: 'other', schemaVersion: 2 })) },
    { name: 'future.json', buffer: Buffer.from(JSON.stringify({ format: 'boombapbot.project', schemaVersion: 3 })) },
    {
      name: 'broken.boombapbot.json',
      buffer: Buffer.from(JSON.stringify({ ...JSON.parse(storedBefore!), tempo: { coarse: 900, fine: 0 } })),
    },
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
