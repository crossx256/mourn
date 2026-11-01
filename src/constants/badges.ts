export const BADGE_DEFINITIONS = {
  investigator: { label: 'Investigator', icon: 'fas fa-magnifying-glass' },
  comrade_in_arms: { label: 'Comrade in Arms', icon: 'fas fa-people-group' },
  support: { label: 'Support', icon: 'fas fa-headset' },
  donator: { label: 'Donator', icon: 'fas fa-heart' },
  mourn_dev: { label: 'Mourn Dev', icon: 'fas fa-code' },
  mourn_staff: { label: 'Mourn Staff', icon: 'fas fa-shield-halved' },
  egg: { label: 'Egg', icon: 'fas fa-egg' },
  firefighter: { label: 'Firefighter', icon: 'fas fa-fire-extinguisher' },
  creator: { label: 'Creator', icon: 'fas fa-wand-magic-sparkles' },
  early_member: { label: 'Early Member', icon: 'fas fa-hourglass-start' },
  tester: { label: 'Tester', icon: 'fas fa-flask' },
  staff: { label: 'Staff', icon: 'fas fa-id-badge' },
} as const;

export type BadgeKey = keyof typeof BADGE_DEFINITIONS;

export function isBadgeKey(value: string): value is BadgeKey {
  return Object.prototype.hasOwnProperty.call(BADGE_DEFINITIONS, value);
}
