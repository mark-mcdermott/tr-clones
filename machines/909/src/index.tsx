import type { Machine } from '@boombapbot/editor';
import { document909, type Project } from './document';
import { engineSetup, exportPlan } from './engine';
import { RESTING, Session909, memoryOf, type Transient909 } from './session';
import { HardwarePanel, PanelNotes } from './ui/HardwarePanel';
import { KeysHelp, SettingsActions, StatusLines } from './ui/SettingsParts';
import '@tr-clones/panel/styles.css';
import './styles.css';

export * from './engine';
export * from './session';

export const machine909: Machine<Project, Transient909, Session909> = {
  id: '909',
  document: document909,
  memory: memoryOf,
  transient: RESTING,
  bpm: (project) => project.tempo,
  setup: engineSetup,
  exportPlan(project) {
    const plan = exportPlan(project);
    return plan.rhythms.length === 0 ? { error: `track ${project.panel.track + 1} is empty.` } : plan;
  },
  session: (host) => new Session909(host),
  Panel: HardwarePanel,
  SettingsActions,
  StatusLines,
  Notes: PanelNotes,
  keysHelp: <KeysHelp />,
  messages: {
    earlierVersion: 'It was brought up to date.',
    unreadableDraft:
      'Your saved draft could not be read, so the starter patterns were loaded. The unreadable draft was kept in this browser.',
  },
};

/** The name a host imports, whichever machine its build is. */
export { machine909 as machine };
