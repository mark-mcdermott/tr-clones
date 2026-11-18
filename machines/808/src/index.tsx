import type { Machine } from '@boombapbot/editor';
import { document808, tempoBpm, type Project } from './document';
import { engineSetup, exportPlan } from './engine';
import { RESTING, Session808, memoryOf, type Transient808 } from './session';
import { HardwarePanel, PanelNotes } from './ui/HardwarePanel';
import { KeysHelp, SettingsActions, StatusLines } from './ui/SettingsParts';
import './styles.css';

export * from './engine';
export * from './session';

export const machine808: Machine<Project, Transient808, Session808> = {
  id: '808',
  document: document808,
  memory: memoryOf,
  transient: RESTING,
  bpm: (project) => tempoBpm(project.tempo),
  setup: engineSetup,
  exportPlan(project) {
    const plan = exportPlan(project);
    return plan.rhythms.length === 0 ? { error: `rhythm track ${project.panel.selector + 1} is empty.` } : plan;
  },
  session: (host) => new Session808(host),
  Panel: HardwarePanel,
  SettingsActions,
  StatusLines,
  Notes: PanelNotes,
  keysHelp: <KeysHelp />,
  messages: {
    earlierVersion: 'Its pattern is now Basic Rhythm 1.',
    unreadableDraft:
      'Your saved draft could not be read, so the starter rhythms were loaded. The unreadable draft was kept in this browser.',
  },
};

/** The name a host imports, whichever machine its build is. */
export { machine808 as machine };
