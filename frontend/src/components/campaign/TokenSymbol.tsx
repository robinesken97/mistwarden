// Added for Mistwarden on 2026-11-27.
/**
 * A token with no picture as a library or picker shows it: the symbol on the
 * dark disc the map draws (map/tokenSymbols.ts), ringed in the colour of its
 * kind or disposition.
 */

import { hueColour, TOKEN_HUES, tokenKind } from '@/utils/tokenColours';
import type { TokenIcon } from '@/utils/tokenIcons';
import type { Token } from '@/types';
import { useCharacterIcons } from '@/stores/gameStore';
import { SYMBOL_DISC_CENTRE, SYMBOL_DISC_EDGE, tokenIcon, tokenIconUrl } from './map/tokenSymbols';

export default function TokenSymbol({ icon, type, disposition, className = 'w-8 h-8' }: {
  icon: TokenIcon;
  type: string | null | undefined;
  disposition: string | null | undefined;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`${className} rounded-full shrink-0 flex items-center justify-center`}
      style={{
        background: `radial-gradient(circle at 50% 40%, ${SYMBOL_DISC_CENTRE}, ${SYMBOL_DISC_EDGE})`,
        boxShadow: `inset 0 0 0 2px ${hueColour(TOKEN_HUES[tokenKind(type, disposition)])}, 0 0 0 1px rgb(0 0 0 / 0.5)`,
      }}
    >
      <img src={tokenIconUrl(icon)} alt="" className="w-2/3 h-2/3" draggable={false} />
    </div>
  );
}

/**
 * The symbol avatar of a token with no picture, as the map draws it. A masked
 * token (obscured, no name sent) shows a question mark; `token` may be missing
 * (a combatant on another map): the symbol then comes from `characterId`.
 */
export function TokenSymbolAvatar({ token, type, disposition, characterId, className }: {
  token?: Pick<Token, 'icon' | 'statBlock' | 'characterId' | 'obscured' | 'name'>;
  type: string | null | undefined;
  disposition: string | null | undefined;
  characterId?: string | null;
  className?: string;
}) {
  const classIcons = useCharacterIcons();
  if (token?.obscured && !token.name) {
    return (
      <div aria-hidden="true" className={`${className ?? 'w-8 h-8'} rounded-full shrink-0 flex items-center justify-center bg-stone-gray/20 text-sm font-semibold text-stone-gray`}>?</div>
    );
  }
  const icon = tokenIcon(token ?? { characterId: characterId ?? null }, classIcons);
  return <TokenSymbol icon={icon} type={type} disposition={disposition} className={className} />;
}
