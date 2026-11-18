import type { Machine } from '@boombapbot/editor';
import { document606, type Project } from './document';
import { engineSetup, exportPlan } from './engine';
import { RESTING, Session606, memoryOf, type Transient606 } from './session';
import { Panel, PanelNotes } from './ui/Panel';
import { KeysHelp, SettingsActions, StatusLines } from './ui/SettingsParts';
import '@tr-clones/panel/styles.css';
import './styles.css';

export * from './engine';
export * from './lamps';
export * from './session';

export const machine606: Machine<Project, Transient606, Session606> = {
  id: '606',
  document: document606,
  memory: memoryOf,
  transient: RESTING,
  bpm: (project) => project.tempo,
  setup: engineSetup,
  exportPlan,
  session: (host) => new Session606(host),
  Panel,
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
export { machine606 as machine };
