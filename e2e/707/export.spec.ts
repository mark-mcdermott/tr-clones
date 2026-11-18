import { expect, test } from '@playwright/test';
import {
  chooseInstrument,
  closeSettings,
  downloadBytes,
  exportVia,
  functionKey,
  hitCount,
  importChanged,
  openEditor,
  openSettings,
  parseMidi,
  parseWav,
  project,
  setMode,
  stepKey,
  stepsOn,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
});

test('exports the pattern as a one-measure WAV loop with audio in it', async ({ page }) => {
  const download = await exportVia(page, 'export-wav');
  expect(download.suggestedFilename()).toBe('starter-beat.wav');
  const wav = parseWav(await downloadBytes(download));
  expect(wav.channels).toBe(2);
  expect(wav.sampleRate).toBe(44100);
  expect(wav.bits).toBe(24);
  // Four beats at 120 last two seconds, to the frame.
  expect(Math.abs(wav.frames - 88_200)).toBeLessThanOrEqual(1);
  expect(wav.peak).toBeGreaterThan(0.1);
  expect(wav.peak).toBeLessThanOrEqual(1);
  expect(wav.rms).toBeGreaterThan(0.01);

  const sixteen = parseWav(await downloadBytes(await exportVia(page, 'export-wav-16')));
  expect(sixteen.bits).toBe(16);
  expect(sixteen.frames).toBe(wav.frames);
  expect(sixteen.rms).toBeCloseTo(wav.rms, 3);
});

test('a shorter pattern is a shorter loop', async ({ page }) => {
  await setMode(page, 'pattern_step');
  await functionKey(page, 'last_step').click();
  await stepKey(page, 11).click();
  // Twelve sixteenths are three beats: a second and a half.
  const wav = parseWav(await downloadBytes(await exportVia(page, 'export-wav')));
  expect(Math.abs(wav.frames - 66_150)).toBeLessThanOrEqual(1);
});

test('exports a MIDI file with tempo and drum notes on channel 10', async ({ page }) => {
  const snapshot = await project(page);
  const download = await exportVia(page, 'export-midi');
  expect(download.suggestedFilename()).toBe('starter-beat.mid');
  const midi = parseMidi(await downloadBytes(download));
  expect(midi.format).toBe(1);
  expect(midi.trackCount).toBe(2);
  expect(midi.ppq).toBe(480);
  expect(midi.tempoMicros).toBe(500_000);
  expect(midi.trackEnds).toEqual([1920, 1920]);

  const noteOns = midi.notes.filter((note) => note.on);
  expect(noteOns).toHaveLength(hitCount(snapshot));
  expect(midi.notes).toHaveLength(hitCount(snapshot) * 2);
  expect(midi.notes.every((note) => note.channel === 10)).toBe(true);

  // Bass Drum 1 is General MIDI note 36. Its ticks are its steps, and it is
  // louder on the steps the accent row marks.
  const kicks = noteOns.filter((note) => note.note === 36);
  expect(kicks.map((note) => note.tick)).toEqual(stepsOn(snapshot, 'bass_drum').map((index) => index * 120));
  const hats = noteOns.filter((note) => note.note === 42);
  const accents = stepsOn(snapshot, 'accent');
  const loud = Math.max(...hats.map((note) => note.velocity));
  const soft = Math.min(...hats.map((note) => note.velocity));
  expect(loud).toBeGreaterThan(soft);
  for (const note of hats) expect(note.velocity).toBe(accents.includes(note.tick / 120) ? loud : soft);
});

test('the MIDI file names the sound a paired row was given', async ({ page }) => {
  const snapshot = await project(page);
  await setMode(page, 'pattern_step');
  await chooseInstrument(page, 1);
  await chooseInstrument(page, 10);
  const midi = parseMidi(await downloadBytes(await exportVia(page, 'export-midi')));
  const noteOns = midi.notes.filter((note) => note.on);
  // General MIDI: 35 is the second bass drum and 54 the tambourine; 36 and 39 are the first of each pair.
  expect(noteOns.filter((note) => note.note === 36 || note.note === 39)).toHaveLength(0);
  expect(noteOns.filter((note) => note.note === 35).map((note) => note.tick)).toEqual(
    stepsOn(snapshot, 'bass_drum').map((index) => index * 120),
  );
  expect(noteOns.filter((note) => note.note === 54)).toHaveLength(stepsOn(snapshot, 'clap_tambourine').length);
});

test('a chain is exported as a loop of its patterns, and a track as the whole of it', async ({ page }) => {
  const snapshot = await project(page);
  await page.getByTestId('panel-shift').click();
  await stepKey(page, 1).click();
  const chain = parseMidi(await downloadBytes(await exportVia(page, 'export-midi')));
  expect(chain.trackEnds).toEqual([3840, 3840]);
  expect(chain.notes.filter((note) => note.on)).toHaveLength(hitCount(snapshot, 0) + hitCount(snapshot, 1));
  await closeSettings(page);

  // Track I of the starter beat is eight measures.
  await functionKey(page, 'track').click();
  const track = parseMidi(await downloadBytes(await exportVia(page, 'export-midi')));
  expect(track.trackEnds).toEqual([8 * 1920, 8 * 1920]);
  const measures = [0, 0, 0, 1, 0, 0, 0, 2];
  expect(track.notes.filter((note) => note.on)).toHaveLength(measures.reduce((sum, pattern) => sum + hitCount(snapshot, pattern), 0));
  // Its WAV is the eight measures and the last hits ringing out: sixteen seconds and three more.
  const wav = parseWav(await downloadBytes(await exportVia(page, 'export-wav')));
  expect(Math.abs(wav.frames - 19 * 44_100)).toBeLessThanOrEqual(1);
  expect(wav.rms).toBeGreaterThan(0.01);
});

test('an empty track has nothing to export, and says so', async ({ page }) => {
  await functionKey(page, 'track').click();
  await page.getByTestId('panel-shift').click();
  await page.getByTestId('panel-group-1').click();
  await openSettings(page);
  await page.getByTestId('export-menu').click();
  await page.getByTestId('export-midi').click();
  const notice = page.getByTestId('notice');
  await expect(notice).toHaveAttribute('data-kind', 'error');
  await expect(notice).toContainText('The MIDI export failed: track II is empty.');
});

test('exports the project as JSON and imports it back', async ({ page }) => {
  await setMode(page, 'pattern_step');
  await chooseInstrument(page, 14);
  await stepKey(page, 0).click();
  await page.getByTestId('panel-fader-bass_drum').focus();
  await page.keyboard.press('PageDown');
  const saved = await project(page);

  const download = await exportVia(page, 'export-project');
  expect(download.suggestedFilename()).toBe('starter-beat.boombapbot.json');
  const bytes = await downloadBytes(download);
  const document = JSON.parse(bytes.toString('utf8'));
  expect(document).toMatchObject({ format: 'boombapbot.project', machine: '707', schemaVersion: 1 });
  expect(document.groups).toEqual(saved.groups);
  expect(document.groups.a).toHaveLength(16);
  expect(document.groups.b).toHaveLength(16);
  expect(document.tracks).toHaveLength(4);
  expect(document.mix.levels.bass_drum).toBe(0.55);

  // Change the machine, then import the file to get it back.
  await openSettings(page);
  await page.getByTestId('clear').click();
  expect(hitCount(await project(page))).toBe(0);
  await closeSettings(page);
  await page.getByTestId('panel-fader-bass_drum').focus();
  await page.keyboard.press('Home');
  await page.getByTestId('import-input').setInputFiles({
    name: 'starter-beat.boombapbot.json',
    mimeType: 'application/json',
    buffer: bytes,
  });
  await expect(page.getByTestId('notice')).toContainText('Imported');
  // Patterns, faders and switches all come back; only the time of the change is new.
  const restored = await project(page);
  expect({ ...restored, updatedAt: saved.updatedAt }).toEqual(saved);
  await expect(page.getByTestId('panel-fader-bass_drum')).toHaveAttribute('aria-valuenow', '55');

  // Undo brings back what was there before the import.
  await page.keyboard.press('Control+z');
  expect(hitCount(await project(page))).toBe(0);
  expect((await project(page)).mix.levels.bass_drum).toBe(0);
});

test('a long track is cut to five minutes of WAV, and the MIDI holds it all', async ({ page }) => {
  await importChanged(page, (next) => {
    next.tempo = 40;
    next.tracks[0] = { group: 'a', measures: Array.from({ length: 60 }, () => 0) };
  });
  await functionKey(page, 'track').click();
  // A measure at 40 lasts six seconds, so fifty of them fit.
  const wav = parseWav(await downloadBytes(await exportVia(page, 'export-wav-16')));
  expect(Math.abs(wav.frames - (50 * 6 + 3) * 44_100)).toBeLessThanOrEqual(1);
  await expect(page.getByTestId('notice')).toContainText('The WAV holds the first 50 of 60 measures');
  await closeSettings(page);
  const midi = parseMidi(await downloadBytes(await exportVia(page, 'export-midi')));
  expect(midi.trackEnds).toEqual([60 * 1920, 60 * 1920]);
});
