// ============================================
// The Spell Library, as the server sends it (backend/src/routes/spells.ts,
// campaignSpells.ts and services/spellLibrary.ts).
// ============================================

import type { AreaElement, AreaShape } from '@/constants/areaLimits';
import type { GameSystem } from '@/types';

/** A spell's area as a MapArea takes it: a sphere's or cylinder's radius, a cone's or line's length, a cube's side. */
export interface SpellArea {
  shape: AreaShape;
  sizeFt: number;
  /** A line's width only. */
  widthFt?: number;
}

/** A spell as a campaign's list sends it: every field but the description. */
export interface SpellSummary {
  id: string;
  name: string;
  /** "srd" for the seeded SRD 5.1 spells, "custom" for every other. */
  source: string;
  gameSystem: GameSystem | null;
  /** Null for an SRD or instance spell, the campaign's id for its own. */
  campaignId: string | null;
  level: number;
  school: string | null;
  castingTime: string | null;
  range: string | null;
  components: string | null;
  duration: string | null;
  concentration: boolean;
  ritual: boolean;
  area: SpellArea | null;
  element: AreaElement;
}

/** One spell in full. */
export interface SpellTemplate extends SpellSummary {
  description: string;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What a spell form sends; the server checks it. */
export interface SpellInput {
  name: string;
  level: number;
  school?: string | null;
  castingTime?: string | null;
  range?: string | null;
  components?: string | null;
  duration?: string | null;
  concentration?: boolean;
  ritual?: boolean;
  description?: string;
  area?: SpellArea | null;
  element?: AreaElement;
}

export interface SpellSeedStatus {
  srdCount: number;
  seedInProgress: boolean;
  /** Whether the caller is a platform admin, who alone imports the SRD and writes the instance's own spells. */
  canSeed: boolean;
}
