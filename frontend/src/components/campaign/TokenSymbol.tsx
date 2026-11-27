// Added for Mistwarden on 2026-11-27.
/**
 * A token with no picture as a library or picker shows it: the symbol on the
 * dark disc the map draws (map/tokenSymbols.ts), ringed in the colour of its
 * kind or disposition.
 */

import { hueColour, TOKEN_HUES, tokenKind } from '@/utils/tokenColours';
import type { TokenIcon } from '@/utils/tokenIcons';
import { SYMBOL_DISC_CENTRE, SYMBOL_DISC_EDGE, tokenIconUrl } from './map/tokenSymbols';

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
