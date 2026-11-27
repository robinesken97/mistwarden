// Added for Mistwarden on 2026-11-27.
/**
 * Every roll the table sees tumbles across the screen as dice that land on
 * the server's result (src/dice). Each device picks 3D, simple or off in
 * its display settings (DisplaySettings.tsx); the choice stays on that
 * device. A roll this viewer may not see is never drawn, exactly as the Dice
 * tab decides.
 */

import { useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useCampaign } from '@/contexts/CampaignContext';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { createDiceLayer } from '@/dice/layer';
import { parseDiceMode, type DiceMode } from '@/dice/mode';
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

/** Mistwarden, 2026-11-27: how this device draws fog: drifting mist, still mist, or flat as before. */
export const FOG_MIST_MODES = ['mist', 'still', 'flat'] as const;
export type FogMistMode = (typeof FOG_MIST_MODES)[number];
export const FOG_MIST_KEY = 'mistwarden.fogMist';
/** Sent when this device's choice changes, so the map redraws without a reload. */
export const FOG_MIST_EVENT = 'mistwarden:fogmist';
export const fogMistMode = (): FogMistMode => {
  const value = optionalStorage.getItem(FOG_MIST_KEY);
  return FOG_MIST_MODES.some((m) => m === value) ? (value as FogMistMode) : 'mist';
};
