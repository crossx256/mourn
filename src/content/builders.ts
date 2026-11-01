export interface BuilderCategory {
  id: 'code' | 'design' | 'visual-identity' | 'sound';
  title: string;
  description: string;
  contributors: { name: string; contribution: string }[];
}

export const buildersIntro =
  'Mourn is built by the Mourn Team, bringing together code, design, visual identity, and sound. The team created the Mourn logos, notification sounds, and Mourn sounds.';

// Add confirmed contributor names and their contributions to the appropriate list.
export const builderCategories: BuilderCategory[] = [
  { id: 'code', title: 'Code', description: 'Engineering and development of Mourn.', contributors: [] },
  { id: 'design', title: 'Design', description: 'Interface and experience design.', contributors: [] },
  {
    id: 'visual-identity',
    title: 'Visual identity',
    description: 'Mourn logos and visual identity, created by the Mourn Team.',
    contributors: [],
  },
  {
    id: 'sound',
    title: 'Sound',
    description: 'Notification sounds and Mourn sounds, created by the Mourn Team.',
    contributors: [],
  },
];

export const signalDocsUrl = 'https://signal.org/docs/';
