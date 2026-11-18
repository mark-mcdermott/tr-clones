import type { DocumentKind } from '@boombapbot/contracts';
import { createProject, parseProject, serializeProject, type Project } from './project';

export * from './roles';
export * from './machine';
export * from './project';
export * from './starter';
export * from './hardware';

/**
 * The 808's documents. They carry no machine name: they are the ones made
 * before a project said which machine it belongs to, and they stay that way.
 */
export const document808: DocumentKind<Project> = {
  machine: '808',
  draftKey: 'boombapbot.draft.v2',
  earlierDraftKeys: ['boombapbot.draft.v1'],
  owns: (header) => header.machine === undefined,
  parse: parseProject,
  serialize: serializeProject,
  create: ({ id, now }) => createProject({ id, now, name: 'Starter beat', bpm: 118 }),
};

/** The name a host imports, whichever machine its build is. */
export { document808 as documentKind };
