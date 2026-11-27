// Added for Mistwarden on 2026-11-27.
/**
 * Opens a gallery picture on a player's screen the moment the GM shows it to
 * them (`gallery.shown`), and closes it when the GM hides it again. Shown
 * pictures stay in the Gallery panel; this only announces a new one, so a
 * reload does not open it again.
 */

import { useEffect, useState } from 'react';
import { Images } from 'lucide-react';
import { useCampaign } from '@/contexts/CampaignContext';
import { useWebSocket } from '@/contexts/WebSocketContext';
import api from '@/services/api';
import Modal from '@/components/ui/Modal';
import type { GalleryPicture } from '@/types';

export default function GalleryPopup() {
  const { campaign, userRole } = useCampaign();
  const { socket } = useWebSocket();
  const campaignId = campaign?.id;
  const [picture, setPicture] = useState<GalleryPicture | null>(null);

  useEffect(() => {
    if (!socket || !campaignId || userRole === 'GM') return;
    const onShown = (data: { campaignId: string; picture: GalleryPicture }) => {
      if (data.campaignId === campaignId) setPicture(data.picture);
    };
    socket.onGalleryShown(onShown);
    return () => { socket.off('gallery.shown', onShown); };
  }, [socket, campaignId, userRole]);

  // Hidden again while open: close it rather than leave a picture the server no longer serves.
  useEffect(() => {
    if (!socket || !campaignId || !picture) return;
    const onChanged = async (data: { campaignId: string }) => {
      if (data.campaignId !== campaignId) return;
      const { pictures } = await api.listGallery(campaignId).catch(() => ({ pictures: [] as GalleryPicture[] }));
      if (!pictures.some((p) => p.id === picture.id)) setPicture(null);
    };
    socket.onGalleryChanged(onChanged);
    return () => { socket.off('gallery.changed', onChanged); };
  }, [socket, campaignId, picture]);

  return (
    <Modal open={picture !== null} onClose={() => setPicture(null)} title={picture?.name ?? ''} icon={Images} size="xl">
      {picture && <img src={picture.url} alt={picture.name} className="w-full h-auto max-h-[75vh] object-contain" />}
    </Modal>
  );
}
