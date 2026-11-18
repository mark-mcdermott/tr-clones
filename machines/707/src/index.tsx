import type { Machine } from '@boombapbot/editor';
import { document707, type Project } from './document';
import { engineSetup, exportPlan } from './engine';
import { RESTING, Session707, memoryOf, type Transient707 } from './session';
import { HardwarePanel, PanelNotes } from './ui/HardwarePanel';
import { KeysHelp, SettingsActions, StatusLines } from './ui/SettingsParts';
import '@tr-clones/panel/styles.css';
import './styles.css';

export * from './engine';
export * from './session';

export const machine707: Machine<Project, Transient707, Session707> = {
  id: '707',
  document: document707,
  memory: memoryOf,
  transient: RESTING,
  bpm: (project) => project.tempo,
  setup: engineSetup,
  exportPlan,
  session: (host) => new Session707(host),
  Panel: HardwarePanel,
  SettingsActions,
  StatusLines,
  Notes: PanelNotes,
  keysHelp: <KeysHelp />,
  messages: {
    earlierVersion: 'What changed on the way is listed here.',
    unreadableDraft:
      'Your saved draft could not be read, so the starter beat was loaded. The unreadable draft was kept in this browser.',
  },
};

/** The name a host imports, whichever machine its build is. */
export { machine707 as machine };
