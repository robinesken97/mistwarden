// Added for Mistwarden on 2026-11-27.
/**
 * Every roll the table sees tumbles across the screen as dice that land on
 * the server's result (src/dice). Each device picks 3D, simple or off in the
 * Dice tab (DiceAnimationSetting); the choice stays on that device. A roll
 * this viewer may not see is never drawn, exactly as the Dice tab decides.
 */

import { useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useCampaign } from '@/contexts/CampaignContext';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { createDiceLayer } from '@/dice/layer';
import { DICE_MODES, parseDiceMode, type DiceMode } from '@/dice/mode';
import { planRoll } from '@/dice/plan';
import { optionalStorage } from '@/utils/optionalStorage';
import { mayDisplayRoll } from '@/utils/secretRolls';
import type { DiceRolledEvent } from '@/types';
import '@/styles/dice.css';

export const DICE_MODE_KEY = 'mistwarden.diceMode';

/** This device's choice: 3D unless it chose otherwise. */
export const diceMode = (): DiceMode => parseDiceMode(optionalStorage.getItem(DICE_MODE_KEY));

/** The roller's own dice are amber, everyone else's lavender: the lantern's two colours. */
const OWN = '#e0a458';
const OTHERS = '#a99be0';

export default function DiceOverlay() {
  const host = useRef<HTMLDivElement>(null);
  const { socket } = useWebSocket();
  const { user } = useAuth();
  const { userRole } = useCampaign();

  useEffect(() => {
    if (!socket || !host.current) return;
    const layer = createDiceLayer(diceMode);
    host.current.appendChild(layer.el);
    const onRolled = (roll: DiceRolledEvent) => {
      if (!mayDisplayRoll(roll, user?.id, userRole === 'GM')) return;
      const plan = planRoll(roll.breakdown?.rolls ?? [], roll.id ?? `${roll.timestamp}${roll.expression}`);
      if (plan) void layer.play(plan, roll.userId && roll.userId === user?.id ? OWN : OTHERS);
    };
    socket.onDiceRolled(onRolled);
    return () => {
      socket.off('dice.rolled', onRolled);
      layer.destroy();
    };
  }, [socket, user?.id, userRole]);

  return <div ref={host} className="fixed inset-0 z-40 pointer-events-none" aria-hidden="true" />;
}

const LABELS: Record<DiceMode, string> = { '3d': '3D', simple: 'Simple', off: 'Off' };

/** The Dice tab's choice of how rolls are shown on this device. */
export function DiceAnimationSetting() {
  return (
    <label className="flex items-center gap-2 text-xs text-warm-gray">
      Dice animation
      <select
        defaultValue={diceMode()}
        onChange={(e) => optionalStorage.setItem(DICE_MODE_KEY, e.target.value)}
        className="px-1.5 py-0.5 text-xs border border-warm-amber/30 rounded-cozy bg-parchment/60"
      >
        {DICE_MODES.map((mode) => <option key={mode} value={mode}>{LABELS[mode]}</option>)}
      </select>
    </label>
  );
}
