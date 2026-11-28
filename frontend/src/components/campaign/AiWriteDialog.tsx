// Added for Mistwarden on 2026-11-27.
/**
 * A GM asks the server's AI for an NPC, a passage to read aloud, or notes.
 * The text comes back to the GM alone; PersonalNotes keeps it as a new
 * private note, which the GM can edit or share as they like.
 */

import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import api from '@/services/api';
import { apiErrorMessage } from '@/utils/errors';

/** The window event the wide layout's AI button sends; the Notes panel, which saves what is written, opens the dialog on it. */
export const AI_WRITE_EVENT = 'mistwarden:ai-write';

export type AiKind = 'npc' | 'read-aloud' | 'note';

const KINDS: Array<{ value: AiKind; label: string; title: string; hint: string }> = [
  { value: 'npc', label: 'NPC', title: 'NPC', hint: 'e.g. A nervous innkeeper who hides a letter from his missing son' },
  { value: 'read-aloud', label: 'Read-aloud text', title: 'Read aloud', hint: 'e.g. The party enters a misty village square at dusk' },
  { value: 'note', label: 'Notes', title: 'Notes', hint: 'e.g. Three rumours the villagers tell about the castle' },
];

interface Props {
  open: boolean;
  campaignId: string;
  onClose: () => void;
  /** Called with a title and the text; the dialog closes after. */
  onWritten: (title: string, text: string) => Promise<void>;
}

export default function AiWriteDialog({ open, campaignId, onClose, onWritten }: Props) {
  const [kind, setKind] = useState<AiKind>('npc');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = KINDS.find((k) => k.value === kind)!;

  const write = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { text } = await api.writeWithAi(campaignId, kind, prompt.trim());
      await onWritten(`${chosen.title}: ${prompt.trim().slice(0, 60)}`, text);
      setPrompt('');
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err) ?? 'The text could not be written.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title="Write with AI"
      icon={Sparkles}
      size="md"
      closeDisabled={busy}
      footer={
        <button
          type="button"
          onClick={() => { void write(); }}
          disabled={busy || !prompt.trim()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-cozy border border-warm-amber/40 bg-warm-amber/15 text-accent-ink hover:bg-warm-amber/25 disabled:opacity-60"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {busy ? 'Writing…' : 'Write'}
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        <div role="group" aria-label="What to write" className="flex flex-wrap gap-1">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              aria-pressed={kind === k.value}
              onClick={() => setKind(k.value)}
              className={`px-2.5 py-1 text-sm rounded-full border ${
                kind === k.value ? 'bg-warm-amber/25 border-warm-amber text-accent-ink' : 'border-warm-amber/30 text-warm-gray hover:bg-warm-amber/10'
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={chosen.hint}
          aria-label="What the text is about"
          maxLength={2000}
          rows={5}
          className="w-full px-2 py-1.5 text-sm border border-warm-amber/30 rounded-cozy bg-parchment/60 focus:outline-hidden focus:ring-2 focus:ring-warm-amber"
        />
        <p className="text-xs text-warm-gray">
          Sent to the AI this server is set up with: your request, the campaign&apos;s name and its game system. The text is saved as a new private note.
        </p>
        {error && <p className="text-xs text-danger-ink">{error}</p>}
      </div>
    </Modal>
  );
}
