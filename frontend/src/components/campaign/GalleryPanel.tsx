// Added for Mistwarden on 2026-11-27.
/**
 * The Gallery panel. The GM files pictures in named folders and shows each
 * to every player or to chosen ones; a player sees the pictures shown to
 * them. A picture shown to a player opens on their screen (GalleryPopup).
 *
 * A gallery picture is uploaded as a map picture of the campaign, which the
 * server keeps from players until the gallery shows it to them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Images, Upload, Trash2, Pencil, Loader2 } from 'lucide-react';
import { useCampaign } from '@/contexts/CampaignContext';
import { useWebSocket } from '@/contexts/WebSocketContext';
import api from '@/services/api';
import { apiErrorMessage } from '@/utils/errors';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import Modal from '@/components/ui/Modal';
import { AssetScope, AssetType, type GalleryPicture } from '@/types';
import { UPLOAD_EXTENSIONS } from '@/constants/uploadTypes';

const pill = (on: boolean) =>
  `touch-hit px-2 py-0.5 text-xs rounded-full border transition-colors ${
    on ? 'bg-warm-amber/25 border-warm-amber text-accent-ink' : 'border-warm-amber/30 text-warm-gray hover:bg-warm-amber/10'
  }`;

const field =
  'px-2 py-1 text-sm border border-warm-amber/30 rounded-cozy bg-parchment/60 focus:outline-hidden focus:ring-2 focus:ring-warm-amber';

/** The file's name without its extension, as a picture's first name. */
const baseName = (file: File) => file.name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Picture';

export default function GalleryPanel() {
  const { campaign, userRole } = useCampaign();
  const { socket } = useWebSocket();
  const campaignId = campaign?.id;
  const isGm = userRole === 'GM';
  const [pictures, setPictures] = useState<GalleryPicture[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadFolder, setUploadFolder] = useState('');
  const [viewing, setViewing] = useState<GalleryPicture | null>(null);
  const [removing, setRemoving] = useState<GalleryPicture | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const players = useMemo(
    () => (campaign?.memberships ?? []).filter((m) => m.role !== 'GM'),
    [campaign?.memberships]
  );

  const load = useCallback(async () => {
    if (!campaignId) return;
    try {
      setPictures((await api.listGallery(campaignId)).pictures);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err) ?? 'The gallery could not be loaded');
    }
  }, [campaignId]);

  useEffect(() => { void load(); }, [load]);

  // Another page changed the gallery, or showed or hid a picture: read it again.
  useEffect(() => {
    if (!socket || !campaignId) return;
    const onChanged = (data: { campaignId: string }) => { if (data.campaignId === campaignId) void load(); };
    socket.onGalleryChanged(onChanged);
    return () => { socket.off('gallery.changed', onChanged); };
  }, [socket, campaignId, load]);

  const folders = useMemo(() => [...new Set(pictures.map((p) => p.folder ?? ''))].sort((a, b) => a.localeCompare(b)), [pictures]);

  const change = async (picture: GalleryPicture, body: Parameters<typeof api.updateGalleryPicture>[2]) => {
    if (!campaignId) return;
    try {
      const { picture: saved } = await api.updateGalleryPicture(campaignId, picture.id, body);
      setPictures((all) => all.map((p) => (p.id === saved.id ? saved : p)));
    } catch (err) {
      setError(apiErrorMessage(err) ?? 'The picture could not be changed');
    }
  };

  const upload = async (files: FileList | null) => {
    if (!campaignId || !files?.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of [...files]) {
        // The type first: the server reads the parts in order (services/drawnPicture.ts).
        const form = new FormData();
        form.append('type', AssetType.MAP);
        form.append('scope', AssetScope.CAMPAIGN);
        form.append('campaignId', campaignId);
        form.append('name', baseName(file));
        form.append('tags', 'gallery');
        form.append('file', file);
        const { asset } = await api.uploadAsset(form);
        await api.addGalleryPicture(campaignId, { assetId: asset.id, name: baseName(file), folder: uploadFolder.trim() });
      }
      await load();
    } catch (err) {
      setError(apiErrorMessage(err) ?? 'The picture could not be added');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const remove = async () => {
    if (!campaignId || !removing) return;
    try {
      await api.removeGalleryPicture(campaignId, removing.id);
      setPictures((all) => all.filter((p) => p.id !== removing.id));
    } catch (err) {
      setError(apiErrorMessage(err) ?? 'The picture could not be removed');
    } finally {
      setRemoving(null);
    }
  };

  const rename = (picture: GalleryPicture) => {
    const name = window.prompt('Name', picture.name)?.trim();
    if (name && name !== picture.name) void change(picture, { name });
  };

  const refile = (picture: GalleryPicture) => {
    const folder = window.prompt('Folder (empty for none)', picture.folder ?? '');
    if (folder !== null && folder.trim() !== (picture.folder ?? '')) void change(picture, { folder: folder.trim() });
  };

  const toggleAll = (picture: GalleryPicture) =>
    void change(picture, picture.shownToAll ? { shownToAll: false } : { shownToAll: true, shownTo: [] });

  const togglePlayer = (picture: GalleryPicture, userId: string) => {
    // With Everyone on, a player's pill takes that player out of everyone.
    const shownTo = picture.shownToAll ? players.map((m) => m.userId) : picture.shownTo ?? [];
    void change(picture, {
      shownToAll: false,
      shownTo: shownTo.includes(userId) ? shownTo.filter((id) => id !== userId) : [...shownTo, userId],
    });
  };

  const thumb = (picture: GalleryPicture) => (
    <button
      type="button"
      onClick={() => setViewing(picture)}
      title={`Open ${picture.name}`}
      className="shrink-0 w-14 h-14 rounded-cozy overflow-hidden border border-warm-amber/30 bg-parchment/40"
    >
      <img src={picture.thumbnailUrl} alt={picture.name} className="w-full h-full object-cover" loading="lazy" />
    </button>
  );

  return (
    <>
      <ConfirmDialog
        isOpen={removing !== null}
        title="Remove picture"
        message={`Take "${removing?.name ?? ''}" out of the gallery? Players no longer see it; the file stays in the asset library.`}
        confirmLabel="Remove"
        variant="danger"
        onConfirm={() => { void remove(); }}
        onCancel={() => setRemoving(null)}
      />
      <Modal open={viewing !== null} onClose={() => setViewing(null)} title={viewing?.name ?? ''} icon={Images} size="xl">
        {viewing && <img src={viewing.url} alt={viewing.name} className="w-full h-auto max-h-[75vh] object-contain" />}
      </Modal>

      <div className="flex flex-col gap-3">
        {isGm && (
          <div className="flex items-center gap-2">
            <input
              list="gallery-folders"
              value={uploadFolder}
              onChange={(e) => setUploadFolder(e.target.value)}
              placeholder="Folder for new pictures"
              aria-label="Folder for new pictures"
              maxLength={80}
              className={`${field} flex-1 min-w-0 pointer-coarse:min-h-11`}
            />
            <datalist id="gallery-folders">
              {folders.filter(Boolean).map((f) => <option key={f} value={f} />)}
            </datalist>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={UPLOAD_EXTENSIONS.MAP.join(',')}
              className="hidden"
              onChange={(e) => { void upload(e.target.files); }}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
              className="touch-target inline-flex items-center gap-1 px-2 py-1 text-sm rounded-cozy border border-warm-amber/40 bg-warm-amber/10 text-accent-ink hover:bg-warm-amber/15 disabled:opacity-60"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Add
            </button>
          </div>
        )}

        {error && <p className="text-xs text-danger-ink">{error}</p>}

        {pictures.length === 0 && (
          <div className="flex flex-col items-center text-center px-4 py-8">
            <Images className="w-9 h-9 text-warm-gray/40 mb-2" />
            <p className="text-sm text-warm-gray">
              {isGm ? 'No pictures yet. Add some, file them in folders and show them to your players.' : 'Nothing has been shown to you yet.'}
            </p>
          </div>
        )}

        {!isGm && pictures.length > 0 && (
          <ul className="grid grid-cols-2 gap-2">
            {pictures.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => setViewing(p)} className="w-full text-left">
                  <img src={p.thumbnailUrl} alt="" className="w-full aspect-square object-cover rounded-cozy border border-warm-amber/30" loading="lazy" />
                  <span className="block mt-1 text-xs truncate">{p.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {isGm && folders.map((folder) => (
          <details key={folder || '(none)'} open className="group">
            <summary className="touch-target flex items-center cursor-pointer text-xs font-semibold uppercase tracking-wide text-warm-gray">
              {folder || 'No folder'} <span className="font-normal">({pictures.filter((p) => (p.folder ?? '') === folder).length})</span>
            </summary>
            <ul className="mt-2 flex flex-col gap-2">
              {pictures.filter((p) => (p.folder ?? '') === folder).map((p) => (
                <li key={p.id} className="flex gap-2">
                  {thumb(p)}
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <div className="flex items-center gap-1">
                      <span className="flex-1 min-w-0 text-sm truncate" title={p.name}>{p.name}</span>
                      <button type="button" onClick={() => rename(p)} aria-label={`Rename ${p.name}`} title="Rename" className="touch-target inline-flex items-center justify-center p-1 text-warm-gray hover:text-accent-ink">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={() => refile(p)} aria-label={`Move ${p.name} to another folder`} title="Move to folder" className="touch-target inline-flex items-center justify-center p-1 text-warm-gray hover:text-accent-ink text-xs">
                        Folder
                      </button>
                      <button type="button" onClick={() => setRemoving(p)} aria-label={`Remove ${p.name}`} title="Remove" className="touch-target inline-flex items-center justify-center p-1 text-warm-gray hover:text-danger-ink">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1" role="group" aria-label={`Who sees ${p.name}`}>
                      <button type="button" aria-pressed={!!p.shownToAll} onClick={() => toggleAll(p)} className={pill(!!p.shownToAll)}>
                        Everyone
                      </button>
                      {players.map((m) => {
                        const on = !!p.shownToAll || (p.shownTo ?? []).includes(m.userId);
                        return (
                          <button key={m.userId} type="button" aria-pressed={on} onClick={() => togglePlayer(p, m.userId)} className={pill(on)}>
                            {m.user?.displayName ?? 'Player'}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </>
  );
}
