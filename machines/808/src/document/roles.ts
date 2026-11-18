import rolesDocument from '../../data/roles.json';

/**
 * A role is one sound the engine can play. Its `index` is the engine's sound
 * slot and the synthesiser's sound number, and must never be reassigned: new
 * roles are appended.
 */
export const ROLE_IDS = [
  'kick',
  'snare',
  'closed_hat',
  'open_hat',
  'low_tom',
  'high_tom',
  'clap',
  'cymbal',
  'mid_tom',
  'rim_shot',
  'cowbell',
  'low_conga',
  'mid_conga',
  'high_conga',
  'claves',
  'maracas',
] as const;

export type RoleId = (typeof ROLE_IDS)[number];

export interface Role {
  id: RoleId;
  /** Engine sound slot. */
  index: number;
  name: string;
  short: string;
  /** General MIDI percussion note used for MIDI export. */
  gmNote: number;
}

function loadRoles(): Role[] {
  const roles = rolesDocument.roles as Role[];
  const ids = roles.map((role) => role.id);
  if (ids.length !== ROLE_IDS.length || ROLE_IDS.some((id, i) => ids[i] !== id)) {
    throw new Error('data/roles.json does not match ROLE_IDS');
  }
  roles.forEach((role, i) => {
    if (role.index !== i) throw new Error(`role ${role.id} must have index ${i}`);
  });
  return roles;
}

export const ROLES: readonly Role[] = loadRoles();

const byId = new Map<RoleId, Role>(ROLES.map((role) => [role.id, role]));

export function getRole(id: RoleId): Role {
  const role = byId.get(id);
  if (!role) throw new Error(`unknown role: ${id}`);
  return role;
}

export function isRoleId(value: unknown): value is RoleId {
  return typeof value === 'string' && byId.has(value as RoleId);
}
