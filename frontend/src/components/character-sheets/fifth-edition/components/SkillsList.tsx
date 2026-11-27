/**
 * SkillsList Component
 *
 * Displays all 5E skills with proficiency/expertise indicators and bonuses.
 * Passive Perception is shown with the senses (FifthEditionCharacterView).
 */

import React from 'react';
import { Dices } from 'lucide-react';
import { rollTarget } from '../../useSheetRolls';

interface Skill {
  proficient: boolean;
  expertise: boolean;
  bonus: number;
}

interface SkillsListProps {
  skills: {
    acrobatics: Skill;
    animalHandling: Skill;
    arcana: Skill;
    athletics: Skill;
    deception: Skill;
    history: Skill;
    insight: Skill;
    intimidation: Skill;
    investigation: Skill;
    medicine: Skill;
    nature: Skill;
    perception: Skill;
    performance: Skill;
    persuasion: Skill;
    religion: Skill;
    sleightOfHand: Skill;
    stealth: Skill;
    survival: Skill;
  };
  /**
   * Checks the eighteen skills do not cover — tool proficiencies and homebrew.
   * Already carries a derived bonus, so this row draws exactly like the rest.
   */
  customSkills?: { name: string; proficient: boolean; expertise: boolean; bonus: number }[];
  /**
   * Click to roll. Omit outside campaign context. Each row is then a d20 test
   * whose roll menu the sheet's root opens on a right-click or a press and hold.
   */
  onRoll?: (expression: string, purpose: string) => void;
}

// Skill display names (camelCase to Title Case)
const SKILL_NAMES: Record<string, string> = {
  acrobatics: 'Acrobatics',
  animalHandling: 'Animal Handling',
  arcana: 'Arcana',
  athletics: 'Athletics',
  deception: 'Deception',
  history: 'History',
  insight: 'Insight',
  intimidation: 'Intimidation',
  investigation: 'Investigation',
  medicine: 'Medicine',
  nature: 'Nature',
  perception: 'Perception',
  performance: 'Performance',
  persuasion: 'Persuasion',
  religion: 'Religion',
  sleightOfHand: 'Sleight of Hand',
  stealth: 'Stealth',
  survival: 'Survival',
};

/**
 * The mark before a skill: a filled dot for proficiency, a ringed one for
 * expertise, a hollow grey one for neither. Named for a screen reader.
 */
export const ProficiencyDot: React.FC<{ proficient: boolean; expertise: boolean }> = ({ proficient, expertise }) => (
  <span className="flex items-center justify-center" aria-hidden="true">
    {expertise ? (
      <span data-mark="expertise" className="size-2.5 rounded-full bg-(--sheet-accent) outline-1 outline-offset-1 outline-(--sheet-accent)" />
    ) : proficient ? (
      <span data-mark="proficient" className="size-2 rounded-full bg-(--sheet-accent)" />
    ) : (
      <span data-mark="none" className="size-2 rounded-full border border-ink-muted" />
    )}
  </span>
);

/**
 * SkillRow - Single skill display with proficiency indicator
 */
const SkillRow: React.FC<{
  name: string;
  skill: Skill;
  onRoll?: (expression: string, purpose: string) => void;
}> = ({ name, skill, onRoll }) => {
  const formatBonus = (bonus: number): string => {
    return bonus >= 0 ? `+${bonus}` : `${bonus}`;
  };

  const expression = `1d20${formatBonus(skill.bonus)}`;
  const purpose = `${name} Check`;
  const isClickable = !!onRoll;

  return (
    <div
      className={`grid grid-cols-[16px_1fr_auto] items-center gap-x-1 break-inside-avoid border-b border-dotted border-ink/10 px-1 py-0.5 pointer-coarse:min-h-11 rounded-sm group ${
        isClickable ? 'cursor-pointer hover:bg-accent/10 select-none [-webkit-touch-callout:none]' : ''
      }`}
      onClick={isClickable ? () => onRoll(expression, purpose) : undefined}
      {...(isClickable ? rollTarget(expression, purpose, 'FIFTH_EDITION') : undefined)}
    >
      <ProficiencyDot proficient={skill.proficient} expertise={skill.expertise} />
      <span className="text-ink">
        {name}
        {(skill.expertise || skill.proficient) && <span className="sr-only">{skill.expertise ? ' (expertise)' : ' (proficient)'}</span>}
      </span>
      <span className="flex items-center gap-1">
        {isClickable && (
          <Dices aria-hidden="true" className="w-3 h-3 text-accent-ink opacity-0 group-hover:opacity-60 [@media(hover:none)]:opacity-60 transition-opacity" />
        )}
        <span className="font-semibold text-ink tabular-nums">{formatBonus(skill.bonus)}</span>
      </span>
    </div>
  );
};

/**
 * SkillsList - The eighteen skills in two columns, then the player's own.
 */
export const SkillsList: React.FC<SkillsListProps> = ({ skills, customSkills, onRoll }) => {
  return (
    <div className="text-sm">
      <div className="columns-1 gap-x-5 min-[760px]:columns-2">
        {/* Alphabetical, whatever order the sheet stores them in, down the
            first column and then the second. */}
        {Object.keys(SKILL_NAMES).filter((key) => skills[key as keyof typeof skills]).map((key) => (
          <SkillRow key={key} name={SKILL_NAMES[key]} skill={skills[key as keyof typeof skills]} onRoll={onRoll} />
        ))}
      </div>

      {/* The player's own — separated so it is obvious which are the standard
          eighteen and which this character added. */}
      {customSkills && customSkills.length > 0 && (
        <div className="mt-2 pt-2 border-t border-ink/10">
          <div className="text-xs font-semibold text-(--sheet-accent) uppercase tracking-wide px-1 mb-1">
            Your Own Skills
          </div>
          <div className="columns-1 gap-x-5 min-[760px]:columns-2">
            {customSkills.map((custom, index) => (
              <SkillRow
                key={`${custom.name}-${index}`}
                name={custom.name}
                skill={custom}
                onRoll={onRoll}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
