// Player-facing text for the core content (placeholder, WP 0.2). The writer (WP 1.8) owns this
// file: dragon names and epithets, unit names, upgrade names and flavor. Keep the exported shapes.
import type { UnitId } from '../types';

export const UNIT_TEXT: Record<UnitId, { name: string; plural: string }> = {
  footman: { name: 'Footman', plural: 'Footmen' },
  archer: { name: 'Archer', plural: 'Archers' },
};

export const UPGRADE_TEXT: Record<string, { name: string; flavor: string }> = {
  pointySwords: { name: 'Pointier Swords', flavor: 'Research confirms the pointy end is the important end.' },
  whetstone: { name: 'Whetstone', flavor: 'Your sword, but more so.' },
  fletching: { name: 'Honest Fletching', flavor: 'The feathers go at the back.' },
};

export const DRAGON_NAMES: readonly string[] = [
  'Pumpernickel',
  'Smoulderbottom',
  'Gribble',
  'Nibwort',
  'Vexathrax',
  'Snorrow',
  'Pip',
  'Cinderwick',
  'Old Muddle',
  'Brisket',
];

export const DRAGON_EPITHETS: readonly string[] = [
  'the Unready',
  'the Mildly Singed',
  'the Damp',
  'Who Bites Ankles',
  'the Unexpectedly Loud',
  'the Moderately Fearsome',
  'Eater of One (1) Sheep',
  'the Small',
];
