/**
 * FifthEditionCharacterView Component
 *
 * Complete read-only view of a 5E character with all stats, skills, spells, and equipment.
 * Organized in tabs for easy navigation.
 */

import React, { useState, useId } from 'react';
import {
  Shield,
  Swords,
  Package,
  Sparkles,
  User,
  BookOpen,
  LayoutGrid,
  Edit,
  Dices,
} from 'lucide-react';
import { hitDieExpression, hitDiceMaximum, spendRoll, canSpendHitDie } from '@/utils/hitDice';
import { Character } from '../../../types';
import type {
  FifthEditionCharacterData,
  FifthEditionSavingThrow,
} from '../../../types/game-systems';
import { SkillsList } from './components/SkillsList';
import { AttacksList } from './components/AttacksList';
import { InventoryList } from './components/InventoryList';
import { SpellcastingBlock } from './components/SpellcastingBlock';
import {
  passiveScore,
  hasSpellcasting,
  exhaustionLevel,
  exhaustionEffects,
  readCustomSkills,
  fifthEditionCustomSkillBonus,
  fifthEditionSkillBonus,
  fifthEditionSaveBonus,
} from '../../../utils/rules/fifthEdition';
import { fifthEditionInitiativeAdvantage, fifthEditionInitiativeModifier } from '../../../utils/rules/initiative';
import { collectSheetFeatures } from '../../../utils/featureEntries';
import { readProficiencyGroups } from '../../../utils/proficiencies';
import { SheetTabs, sheetTabPanel, type SheetTab } from '../SheetTabs';
import { notARoll, rollTarget, sheetRoll, useSheetRolls, type SheetRollHandler } from '../useSheetRolls';
import { diceExpressionProblem } from '@/utils/diceExpression';
import { attackPurpose, damagePurpose } from '@/utils/rollPurposes';
import { SHEET_BAR, SHEET_BOX, SHEET_BOX_HEADING, SHEET_GAP, SHEET_LABEL, sheetAccentVariables } from './sheetStyle';
import type { RollMode } from '@/utils/rollModes';

interface FifthEditionCharacterViewProps {
  character: Character;
  onEdit?: () => void;
  /** Called when the user clicks a rollable stat. Omit outside campaign context. */
  onRoll?: SheetRollHandler;
  /** The sheet's Roll mode, for every d20 test a click rolls. Normal without one. */
  rollMode?: RollMode;
  /**
   * Called when a hit die is spent, with the position of the pool. Omit and
   * the dice still roll but nothing is decremented.
   */
  onSpendHitDie?: (index: number) => void;
}

type TabId = 'overview' | 'combat' | 'spells' | 'inventory' | 'features' | 'bio';

const TABS: SheetTab<TabId>[] = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'combat', label: 'Combat', icon: Swords },
  { id: 'spells', label: 'Spells', icon: Sparkles },
  { id: 'inventory', label: 'Inventory', icon: Package },
  { id: 'features', label: 'Features', icon: BookOpen },
  { id: 'bio', label: 'Biography', icon: User },
];

/**
 * FifthEditionCharacterView - Read-only 5E character sheet
 */
export const FifthEditionCharacterView: React.FC<FifthEditionCharacterViewProps> = ({ character, onEdit, onRoll, rollMode, onSpendHitDie }) => {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const sheetTabsId = useId();
  const data = character.data as FifthEditionCharacterData;
  const { roll: handleRoll, rollTest, rootProps: rollRoot, menu: rollMenu } = useSheetRolls(onRoll, character.gameSystem, rollMode);

  // A hit die is spent once its roll is made: a roll refused (too many rolls,
  // no connection) used to take the die anyway.
  const spendHitDie = (expression: string, purpose: string, index: number) => {
    void Promise.resolve(handleRoll(expression, purpose)).then((made) => {
      if (made !== false) onSpendHitDie?.(index);
    });
  };

  // Format modifier for display
  const formatModifier = (mod: number): string => {
    return mod >= 0 ? `+${mod}` : `${mod}`;
  };

  const ABILITIES: Array<[string, string, keyof FifthEditionCharacterData['stats']]> = [
    ['STR', 'Strength', 'strength'],
    ['DEX', 'Dexterity', 'dexterity'],
    ['CON', 'Constitution', 'constitution'],
    ['INT', 'Intelligence', 'intelligence'],
    ['WIS', 'Wisdom', 'wisdom'],
    ['CHA', 'Charisma', 'charisma'],
  ];
  const ROLLABLE = 'cursor-pointer hover:bg-accent/10 select-none [-webkit-touch-callout:none]';
  const diceMark = <Dices aria-hidden="true" className="w-3 h-3 text-accent-ink opacity-0 group-hover:opacity-60 [@media(hover:none)]:opacity-60 transition-opacity" />;

  // The six numbers under the name. Darkvision only when the character has it,
  // as most have none.
  const coreNumbers = (): Array<{ label: string; value: React.ReactNode; note?: React.ReactNode }> => {
    const tiles: Array<{ label: string; value: React.ReactNode; note?: React.ReactNode }> = [];
    if (data.armorClass !== undefined) tiles.push({ label: 'Armor Class', value: data.armorClass });
    if (data.hp) {
      tiles.push({
        label: 'Hit Points',
        value: <>{data.hp.current}<span className="text-(--sheet-accent)">/{data.hp.maximum}</span></>,
        note: data.hp.temporary > 0 ? <span className="text-info-ink">+{data.hp.temporary} temp</span> : undefined,
      });
    }
    if (data.speed !== undefined) tiles.push({ label: 'Speed', value: `${data.speed} ft` });
    if (data.stats?.dexterity !== undefined) {
      // Derived from Dexterity and the sheet's other-bonus field rather than
      // read from the stored total, so this matches the editor and what is
      // rolled; the advantage note follows the rule the roll uses, so a level
      // of exhaustion or the poisoned condition that cancels it shows.
      const advantage = fifthEditionInitiativeAdvantage(data);
      tiles.push({
        label: 'Initiative',
        value: formatModifier(fifthEditionInitiativeModifier(data)),
        note: advantage === 'advantage' ? 'With advantage' : advantage === 'cancelled' ? 'Advantage cancelled' : undefined,
      });
    }
    tiles.push({ label: 'Proficiency', value: formatModifier(data.proficiencyBonus) });
    if ((data.darkvisionFeet ?? 0) > 0) tiles.push({ label: 'Darkvision', value: `${data.darkvisionFeet} ft` });
    return tiles;
  };

  // Render character header
  const renderHeader = () => {
    const portrait = data.portraitUrl || character.tokenImageUrl;
    const tiles = coreNumbers();
    // Beside a portrait, three to a row; five of them as three and two wide
    // ones, so no hole is left. Without one, all in a row from sm up.
    const tileSpan = (index: number) => (portrait && tiles.length === 5 && index >= 3 ? 'col-span-3' : 'col-span-2');
    const ROW_OF = ['', 'sm:grid-cols-1', 'sm:grid-cols-2', 'sm:grid-cols-3', 'sm:grid-cols-4', 'sm:grid-cols-5', 'sm:grid-cols-6'];
    const meta = [
      data.background ? <span key="bg">Background: <strong className={SHEET_LABEL}>{data.background}</strong></span> : null,
      data.playerName ? <span key="player">Player: {data.playerName}</span> : null,
      data.experiencePoints !== undefined ? <span key="xp">XP {data.experiencePoints.toLocaleString()}</span> : null,
    ].filter(Boolean);

    return (
      <section data-sheet-header className={`${SHEET_BOX} relative`}>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="ml-auto mb-3 w-fit sm:absolute sm:top-3.5 sm:right-5 sm:mb-0 flex min-h-11 items-center gap-2 rounded-[10px] border-2 border-(--sheet-accent) px-3.5 font-semibold text-(--sheet-accent) transition-colors hover:bg-(--sheet-accent-bg) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--sheet-accent)"
            title="Edit character"
          >
            <Edit className="w-4 h-4" aria-hidden="true" />
            <span>Edit</span>
          </button>
        )}

        <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-5">
          {portrait && (
            <img
              src={portrait}
              alt={data.characterName || 'Character'}
              className="h-30 w-24 shrink-0 rounded-xl border-[3px] border-(--sheet-accent) object-cover sm:h-[164px] sm:w-[132px]"
            />
          )}
          <div className="w-full min-w-0 flex-1">
            <h2 className={`font-heading text-[30px] leading-[1.1] font-semibold text-(--sheet-accent) ${onEdit ? 'sm:pr-28' : ''}`}>
              {data.characterName || 'Unnamed Character'}
            </h2>
            <em className="text-ink-secondary">
              Level {data.level} {data.race} {data.class}{data.alignment ? `, ${data.alignment}` : ''}
            </em>
            {meta.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-x-1.5 text-sm text-ink-secondary">
                {meta.flatMap((item, index) => (index === 0 ? [item] : [<span key={`dot-${index}`} aria-hidden="true">·</span>, item]))}
              </div>
            )}
            <div className={`mt-3.5 grid grid-cols-6 gap-2.5 ${portrait ? '' : `sm:[&>*]:col-span-1 ${ROW_OF[tiles.length]}`}`}>
              {tiles.map((tile, index) => (
                <div key={tile.label} className={`${tileSpan(index)} min-h-16 rounded-[10px] bg-black/20 px-1 py-1.5 text-center`}>
                  <div className="text-[11px] uppercase tracking-[.06em] text-ink-secondary">{tile.label}</div>
                  <div className="font-heading text-[22px] leading-[1.2] font-semibold text-ink">{tile.value}</div>
                  {tile.note && <div className="text-xs text-ink-secondary">{tile.note}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>

        {data.stats && (
          <>
            <hr className={SHEET_BAR} />
            <div className="grid grid-cols-3 gap-y-1.5 text-center sm:grid-cols-6">
              {ABILITIES.map(([label, fullName, key]) => {
                const stat = data.stats[key];
                const expr = stat.modifier >= 0 ? `1d20+${stat.modifier}` : `1d20${stat.modifier}`;
                const purpose = `${fullName} Check`;
                return (
                  <div
                    key={key}
                    className={`group rounded-lg py-1 ${onRoll ? ROLLABLE : ''}`}
                    onClick={onRoll ? () => rollTest(expr, purpose) : undefined}
                    {...(onRoll ? rollTarget(expr, purpose, character.gameSystem) : undefined)}
                  >
                    <b className="block text-xs tracking-[.08em] text-(--sheet-accent)" title={fullName}>{label}</b>
                    <span className="font-heading text-xl font-semibold text-ink">{stat.score}</span>{' '}
                    <span className="text-ink-secondary">({formatModifier(stat.modifier)})</span>
                    {onRoll && <span className="ml-1 inline-block align-middle">{diceMark}</span>}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>
    );
  };

  // The Overview tab: what a stat block shows, in two columns.
  const renderOverviewTab = () => {
    const proficiencies = readProficiencyGroups(data);
    const features = collectSheetFeatures(data);
    const passive = passiveScore(fifthEditionSkillBonus(data, 'perception') + (data.passivePerceptionBonus ?? 0));
    const darkvision = data.darkvisionFeet ?? 0;
    const exhaustion = exhaustionLevel(data.exhaustionLevel);
    const conditions = data.conditions ?? [];
    const COLUMN = `flex min-w-0 flex-col ${SHEET_GAP} [&>*:last-child]:flex-1`;

    return (
      <div className={`grid ${SHEET_GAP} min-[760px]:grid-cols-2`}>
        <div className={COLUMN}>
          <section className={SHEET_BOX}>
            <h3 className={SHEET_BOX_HEADING}>Saves &amp; Senses</h3>
            <div className="space-y-1.5">
              {data.savingThrows && (
                <p>
                  <strong className={SHEET_LABEL}>Saving Throws</strong>{' '}
                  {(Object.entries(data.savingThrows) as [string, FifthEditionSavingThrow][]).map(([key, save], index) => {
                    // Worked out from the scores plus the other bonus, as the
                    // dice roll it, so a stored total gone stale is not shown.
                    const bonus = fifthEditionSaveBonus(data, key);
                    const expr = bonus >= 0 ? `1d20+${bonus}` : `1d20${bonus}`;
                    const name = key.charAt(0).toUpperCase() + key.slice(1);
                    const purpose = `${name} Save`;
                    return (
                      <React.Fragment key={key}>
                        {index > 0 && ', '}
                        <span
                          className={`rounded-sm py-1.5 ${onRoll ? ROLLABLE : ''} ${save.proficient ? 'font-semibold text-ink' : 'text-ink-muted'}`}
                          onClick={onRoll ? () => rollTest(expr, purpose) : undefined}
                          {...(onRoll ? rollTarget(expr, purpose, character.gameSystem) : undefined)}
                        >
                          <abbr title={name} className="no-underline">{name.slice(0, 3)}</abbr> {formatModifier(bonus)}
                          {save.proficient && <span className="sr-only"> (proficient)</span>}
                        </span>
                      </React.Fragment>
                    );
                  })}
                </p>
              )}
              <p>
                <strong className={SHEET_LABEL}>Senses</strong>{' '}
                {darkvision > 0 && `darkvision ${darkvision} ft., `}passive Perception {passive}
              </p>
              {proficiencies.languages.trim() && (
                <p><strong className={SHEET_LABEL}>Languages</strong> {proficiencies.languages}</p>
              )}
              <p>
                <strong className={SHEET_LABEL}>Conditions</strong>{' '}
                {conditions.length > 0 ? <span className="capitalize">{conditions.join(', ')}</span> : 'none'}
                {' · '}<strong className={SHEET_LABEL}>Exhaustion</strong> {exhaustion}
                {data.inspiration !== undefined && (
                  <>{' · '}<strong className={SHEET_LABEL}>Inspiration</strong> {data.inspiration ? 'Yes' : 'No'}</>
                )}
              </p>
            </div>
          </section>

          {data.skills && (
            <section className={SHEET_BOX}>
              <h3 className={SHEET_BOX_HEADING}>
                Skills
                <small className="font-body text-xs font-medium text-ink-secondary" aria-hidden="true">
                  <span className="text-(--sheet-accent)">●</span> proficient
                </small>
              </h3>
              <SkillsList
                // Each total worked out as the dice roll it: from the scores,
                // plus the skill's other bonus.
                skills={Object.fromEntries(
                  Object.entries(data.skills).map(([key, skill]) => [key, { ...skill, bonus: fifthEditionSkillBonus(data, key) }])
                ) as typeof data.skills}
                // Derived here too: the bonus follows the character's ability
                // scores and level rather than being stored and going stale.
                customSkills={readCustomSkills(data).map((custom) => ({
                  name: custom.name,
                  proficient: custom.proficient === true,
                  expertise: custom.expertise === true,
                  bonus: fifthEditionCustomSkillBonus(data, custom),
                }))}
                onRoll={onRoll ? rollTest : undefined}
              />
            </section>
          )}
        </div>

        <div className={COLUMN}>
          <section className={SHEET_BOX}>
            <h3 className={SHEET_BOX_HEADING}>Attacks</h3>
            {renderAttackTable()}
          </section>
          <section className={SHEET_BOX}>
            <h3 className={SHEET_BOX_HEADING}>Features &amp; Traits</h3>
            {features.length > 0 ? (
              <div className="space-y-2">
                {features.map((feature, idx) => (
                  <p key={idx} className="text-ink whitespace-pre-wrap">
                    <strong className={SHEET_LABEL}><em>{feature.name}{feature.description ? '.' : ''}</em></strong>
                    {feature.description && <> {feature.description}</>}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-ink-muted">None recorded</p>
            )}
          </section>
        </div>
      </div>
    );
  };

  // The attacks as a table: the row rolls the attack, the damage chip the
  // damage alone. Additional damage and properties are on the Combat tab.
  const renderAttackTable = () => {
    const attacks = data.attacks ?? [];
    if (attacks.length === 0) return <p className="text-ink-muted">No attacks configured</p>;
    const CHIP = 'inline-block w-full rounded-md border border-(--sheet-accent) px-1.5 py-px text-center font-semibold text-ink tabular-nums';
    return (
      // On a phone the table keeps its columns and scrolls sideways in its box.
      <div className="overflow-x-auto">
      <table className="w-full min-w-[21rem] table-fixed border-collapse text-sm">
        <colgroup>
          <col />
          <col className="w-14 sm:w-[84px]" />
          <col className="w-12 sm:w-16" />
          <col className="w-[4.5rem] sm:w-20" />
          <col className="w-[4.5rem] sm:w-24" />
        </colgroup>
        <thead>
          <tr>
            {['Weapon', 'Range', 'Hit', 'Damage', 'Type'].map((heading) => (
              <th key={heading} className="border-b-2 border-(--sheet-accent) px-0.5 py-1 sm:px-1.5 text-center font-semibold text-(--sheet-accent)">{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {attacks.map((attack, idx) => {
            const expr = `1d20${formatModifier(attack.attackBonus)}`;
            const purpose = attackPurpose(attack.name);
            const damageProblem = onRoll && attack.damageRoll ? diceExpressionProblem(attack.damageRoll) : null;
            const rollsDamage = !!onRoll && !!attack.damageRoll && damageProblem === null;
            return (
              <tr
                key={idx}
                className={`group odd:bg-black/15 ${onRoll ? 'cursor-pointer select-none [-webkit-touch-callout:none] hover:not-has-[[data-not-a-roll]:hover]:bg-accent/10' : ''}`}
                onClick={onRoll ? () => rollTest(expr, purpose) : undefined}
                {...(onRoll ? rollTarget(expr, purpose, character.gameSystem) : undefined)}
              >
                <td className="border-b border-ink/10 px-0.5 py-1.5 text-center align-middle sm:px-1.5">
                  <span className="text-ink">{attack.name}</span>
                  {attack.notes && <small className="block text-[11px] leading-tight text-ink-secondary">{attack.notes}</small>}
                </td>
                <td className="border-b border-ink/10 px-0.5 py-1.5 text-center align-middle sm:px-1.5">{attack.range != null ? `${attack.range} ft` : '—'}</td>
                <td className="border-b border-ink/10 px-0.5 py-1.5 text-center align-middle sm:px-1.5">
                  <span className={CHIP}>{formatModifier(attack.attackBonus)}</span>
                </td>
                <td className="border-b border-ink/10 px-0.5 py-1.5 text-center align-middle sm:px-1.5">
                  {attack.damageRoll ? (
                    <span
                      className={`${CHIP} ${rollsDamage ? 'cursor-pointer hover:bg-(--sheet-accent-bg)' : damageProblem ? 'cursor-default' : ''}`}
                      onClick={onRoll ? (e) => { e.stopPropagation(); handleRoll(attack.damageRoll!, damagePurpose(attack.name)); } : undefined}
                      title={rollsDamage ? `Click to roll damage: ${attack.damageRoll}` : undefined}
                      {...(rollsDamage ? sheetRoll : undefined)}
                      {...(damageProblem ? notARoll(damageProblem) : undefined)}
                    >
                      {attack.damageRoll}
                    </span>
                  ) : '—'}
                </td>
                <td className="border-b border-ink/10 px-0.5 py-1.5 text-center align-middle text-xs sm:px-1.5 sm:text-sm">{attack.damageType || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    );
  };

  // Render Combat tab
  const renderCombatTab = () => (
    <div className={`flex flex-col ${SHEET_GAP}`}>
      {/* Armor Class, hit points, speed, initiative and darkvision are in
          the header, on every tab. */}
      {/* Hit Dice */}
      {data.hitDice && data.hitDice.length > 0 && (
        <div className={SHEET_BOX}>
          <h3 className={SHEET_BOX_HEADING}>Hit Dice</h3>
          <div className="flex flex-wrap gap-3">
            {data.hitDice!.map((hd, idx) => {
              // `total` is the pool ("5d10"), so spending rolls one die plus
              // Constitution — never the stored string, which would roll all
              // five. A pool with nothing left, or a total that is not a die,
              // stays as plain text rather than offering a roll it cannot make.
              const con = data.stats?.constitution?.modifier ?? 0;
              const die = hitDieExpression(hd, con);
              const max = hitDiceMaximum(hd);
              const spendable = !!onRoll && canSpendHitDie(hd, con);
              const expr = die === null ? '' : spendRoll(die, con);
              const purpose = `Spend a Hit Die${hd.class ? ` (${hd.class})` : ''}`;
              return (
                <div
                  key={idx}
                  className={`px-4 py-2 bg-paper border border-ink/20 rounded-lg group ${
                    spendable ? 'cursor-pointer hover:bg-accent/10 select-none' : ''
                  }`}
                  onClick={spendable ? () => spendHitDie(expr, purpose, idx) : undefined}
                  title={spendable ? `Spend one hit die: roll ${expr}` : undefined}
                  {...(spendable ? sheetRoll : undefined)}
                >
                  <div className="text-xs text-ink-muted capitalize">{hd.class}</div>
                  <div className="font-semibold text-ink flex items-center gap-1">
                    {hd.remaining}{max === null ? '' : `/${max}`}
                    {die && <span className="ml-1 font-normal text-ink-muted">{die}</span>}
                    {spendable && <Dices className="w-3 h-3 text-accent-ink opacity-0 group-hover:opacity-60 [@media(hover:none)]:opacity-60 transition-opacity" />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Death Saves */}
      {data.deathSaves && (
        <div className={SHEET_BOX}>
          <h3 className={SHEET_BOX_HEADING}>Death Saves</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-success-ink font-medium mb-2">Successes</div>
              <div className="flex space-x-2">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={`w-8 h-8 rounded-full border-2 ${
                      i <= data.deathSaves!.successes
                        ? 'bg-success border-success'
                        : 'bg-paper border-ink/20'
                    }`}
                  />
                ))}
              </div>
            </div>
            <div>
              <div className="text-sm text-danger-ink font-medium mb-2">Failures</div>
              <div className="flex space-x-2">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={`w-8 h-8 rounded-full border-2 ${
                      i <= data.deathSaves!.failures
                        ? 'bg-danger border-danger'
                        : 'bg-paper border-ink/20'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Conditions */}
      {data.conditions && data.conditions.length > 0 && (
        <div className={SHEET_BOX}>
          <h3 className={SHEET_BOX_HEADING}>Conditions</h3>
          <div className="flex flex-wrap gap-2">
            {data.conditions.map((condition: string, idx: number) => (
              <span
                key={idx}
                className="px-3 py-1 bg-warning/15 text-warning-ink border border-warning/30 rounded-full capitalize"
              >
                {condition}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Exhaustion. Six cumulative levels (SRD 5.1, "Exhaustion"), so the
          effects of every level below the current one apply too. */}
      {exhaustionLevel(data.exhaustionLevel) > 0 && (
        <div className={SHEET_BOX}>
          <h3 className={SHEET_BOX_HEADING}>
            Exhaustion
            <span className="px-2 py-0.5 bg-danger/15 text-danger-ink border border-danger/30 font-body text-sm font-bold rounded-full">
              Level {exhaustionLevel(data.exhaustionLevel)}
            </span>
          </h3>
          <ul className="space-y-0.5">
            {exhaustionEffects(data.exhaustionLevel).map((effect, idx) => (
              <li key={idx} className="flex items-start space-x-2 text-ink-secondary">
                <span className="text-danger-ink">•</span>
                <span>
                  <span className="text-ink-muted mr-1">{idx + 1}.</span>
                  {effect}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Attacks */}
      {data.attacks && (
        <div className={SHEET_BOX}>
          <h3 className={SHEET_BOX_HEADING}>Attacks & Weapons</h3>
          <AttacksList
            attacks={data.attacks}
            onRollAttack={onRoll ? rollTest : undefined}
            onRollDamage={onRoll ? handleRoll : undefined}
          />
        </div>
      )}
    </div>
  );

  // Render Spells tab
  const renderSpellsTab = () => (
    <div>
      {/* `data.spellcasting` is an object on every sheet, including a barbarian's,
          so testing it for truth showed a spellcasting panel to everybody — and
          because the templates seeded class "Wizard", a Fighter's sheet read
          "Wizard Spellcasting". What decides is whether the character actually
          casts: an ability named, or any cantrip, slot or spell recorded. */}
      {hasSpellcasting(data) ? (
        <SpellcastingBlock spellcasting={data.spellcasting!} character={data} />
      ) : (
        <div className="text-center py-12 text-ink-muted">
          <Sparkles className="w-12 h-12 mx-auto mb-3 text-ink-muted" />
          <p>This character is not a spellcaster</p>
        </div>
      )}
    </div>
  );

  // Render Inventory tab
  const renderInventoryTab = () => (
    <div>
      <InventoryList inventory={data.inventory} currency={data.currency} strengthScore={data.stats?.strength?.score} />
    </div>
  );

  // Render Features tab
  const renderFeaturesTab = () => {
    // Read through the shared reader, which returns each box as the player
    // typed it. The categories used to be re-derived here from a hardcoded list
    // of language names, so anything it did not recognise — Thieves' Cant,
    // Druidic, anything homebrew — was shown under Weapons.
    const proficiencies = readProficiencyGroups(data);
    const hasProficiencies = Object.values(proficiencies).some((group) => group.trim().length > 0);
    const features = collectSheetFeatures(data);

    return (
      <div className={`flex flex-col ${SHEET_GAP}`}>
        {/* Proficiencies & Training - Organized like a 5E character sheet */}
        {hasProficiencies && (
          <div className={SHEET_BOX}>
            <h3 className={SHEET_BOX_HEADING}>
              <span className="flex items-center gap-2">
                <Shield className="w-5 h-5" aria-hidden="true" />
                Proficiencies & Training
              </span>
            </h3>

            <div className="space-y-4">
              {/* Armor */}
              {proficiencies.armor.length > 0 && (
                <div>
                  <div className="text-sm font-bold text-(--sheet-accent) mb-2 uppercase tracking-wide">
                    Armor
                  </div>
                  <div className="text-ink">
                    {proficiencies.armor}
                  </div>
                </div>
              )}

              {/* Weapons */}
              {proficiencies.weapons.length > 0 && (
                <div>
                  <div className="text-sm font-bold text-(--sheet-accent) mb-2 uppercase tracking-wide">
                    Weapons
                  </div>
                  <div className="text-ink">
                    {proficiencies.weapons}
                  </div>
                </div>
              )}

              {/* Tools */}
              {proficiencies.tools.length > 0 && (
                <div>
                  <div className="text-sm font-bold text-(--sheet-accent) mb-2 uppercase tracking-wide">
                    Tools
                  </div>
                  <div className="text-ink">
                    {proficiencies.tools}
                  </div>
                </div>
              )}

              {/* Languages */}
              {proficiencies.languages.length > 0 && (
                <div>
                  <div className="text-sm font-bold text-(--sheet-accent) mb-2 uppercase tracking-wide">
                    Languages
                  </div>
                  <div className="text-ink">
                    {proficiencies.languages}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

      {/* Features & Traits.
          Read through the shared reader so a sheet still holding plain strings,
          or the separate field the built-in templates used to write, displays
          the same as a migrated one. Most entries are a bare name — a
          description only appears when there is one. */}
      {features.length > 0 && (
        <div className={SHEET_BOX}>
          <h3 className={SHEET_BOX_HEADING}>Features &amp; Traits</h3>
          <ul className="space-y-2">
            {features.map((feature, idx) => (
              <li key={idx} className="flex items-start space-x-2">
                <span className="text-accent-ink mt-1">•</span>
                <div className="text-ink-secondary">
                  <span className={feature.description ? 'font-semibold' : undefined}>
                    {feature.name}
                  </span>
                  {feature.description && (
                    <p className="text-sm text-ink-secondary whitespace-pre-wrap mt-0.5">
                      {feature.description}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Additional Features */}
      {data.additionalFeaturesAndTraits && (
        <div className={SHEET_BOX}>
          <h3 className={SHEET_BOX_HEADING}>Additional Features</h3>
          <p className="text-ink-secondary whitespace-pre-wrap">{data.additionalFeaturesAndTraits}</p>
        </div>
      )}
    </div>
    );
  };

  // Render Biography tab
  const renderBioTab = () => (
    <div className={`flex flex-col ${SHEET_GAP}`}>
      {/* Appearance */}
      {data.appearance && (
        <div className={SHEET_BOX}>
          <h3 className={SHEET_BOX_HEADING}>Appearance</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <div className="text-xs text-ink-muted">Age</div>
              <div className="text-ink">{data.appearance.age}</div>
            </div>
            <div>
              <div className="text-xs text-ink-muted">Height</div>
              <div className="text-ink">{data.appearance.height}</div>
            </div>
            <div>
              <div className="text-xs text-ink-muted">Weight</div>
              <div className="text-ink">{data.appearance.weight}</div>
            </div>
            <div>
              <div className="text-xs text-ink-muted">Eyes</div>
              <div className="text-ink">{data.appearance.eyes}</div>
            </div>
            <div>
              <div className="text-xs text-ink-muted">Skin</div>
              <div className="text-ink">{data.appearance.skin}</div>
            </div>
            <div>
              <div className="text-xs text-ink-muted">Hair</div>
              <div className="text-ink">{data.appearance.hair}</div>
            </div>
          </div>
        </div>
      )}

      {/* Personality */}
      {data.personality && (
        <div className={SHEET_BOX}>
          <h3 className={SHEET_BOX_HEADING}>Personality</h3>
          <div className="space-y-3">
            {data.personality.traits && (
              <div>
                <div className="text-sm font-bold text-(--sheet-accent) mb-1">Traits</div>
                <p className="text-ink-secondary">{data.personality.traits}</p>
              </div>
            )}
            {data.personality.ideals && (
              <div>
                <div className="text-sm font-bold text-(--sheet-accent) mb-1">Ideals</div>
                <p className="text-ink-secondary">{data.personality.ideals}</p>
              </div>
            )}
            {data.personality.bonds && (
              <div>
                <div className="text-sm font-bold text-(--sheet-accent) mb-1">Bonds</div>
                <p className="text-ink-secondary">{data.personality.bonds}</p>
              </div>
            )}
            {data.personality.flaws && (
              <div>
                <div className="text-sm font-bold text-(--sheet-accent) mb-1">Flaws</div>
                <p className="text-ink-secondary">{data.personality.flaws}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Backstory */}
      {data.backstory && (
        <div className={SHEET_BOX}>
          <h3 className={SHEET_BOX_HEADING}>Backstory</h3>
          <p className="text-ink-secondary whitespace-pre-wrap">{data.backstory}</p>
        </div>
      )}

      {/* Allies & Organizations */}
      {data.alliesAndOrganizations && (
        <div className={SHEET_BOX}>
          <h3 className={SHEET_BOX_HEADING}>Allies & Organizations</h3>
          <div className="space-y-2">
            <div className="font-medium text-ink">{data.alliesAndOrganizations.name}</div>
            <p className="text-ink-secondary">{data.alliesAndOrganizations.description}</p>
          </div>
        </div>
      )}

      {/* Treasure */}
      {data.treasure && (
        <div className={SHEET_BOX}>
          <h3 className={SHEET_BOX_HEADING}>Treasure</h3>
          <p className="text-ink-secondary whitespace-pre-wrap">{data.treasure}</p>
        </div>
      )}
    </div>
  );

  // Render active tab content
  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return renderOverviewTab();
      case 'combat':
        return renderCombatTab();
      case 'spells':
        return renderSpellsTab();
      case 'inventory':
        return renderInventoryTab();
      case 'features':
        return renderFeaturesTab();
      case 'bio':
        return renderBioTab();
      default:
        return null;
    }
  };

  return (
    <div data-sheet-root className={`grid ${SHEET_GAP}`} style={sheetAccentVariables(data.themeColor)} {...rollRoot}>
      {renderHeader()}
      <SheetTabs id={sheetTabsId} tabs={TABS} active={activeTab} onSelect={setActiveTab} variant="boxed" />
      <div data-sheet-body {...sheetTabPanel(sheetTabsId, activeTab)}>{renderTabContent()}</div>

      {/* Advantage / Disadvantage, on a right-click or a press and hold of any d20 test */}
      {rollMenu}
    </div>
  );
};
