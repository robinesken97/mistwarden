/**
 * The 5E sheet's portrait: chosen in the editor, uploaded on save into the
 * sheet's `portraitUrl`, and shown tall in the read-only header, with the
 * token picture standing in without one and nothing drawn without either.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FifthEditionCharacterEditor } from '../FifthEditionCharacterEditor';
import { FifthEditionCharacterView } from '../FifthEditionCharacterView';
import type { CharacterData } from '../../../../types';
import { fifthEditionCharacter } from './fifthEditionFixture';

const uploadAsset = vi.fn();
vi.mock('@/services/api', () => ({ api: { uploadAsset: (form: FormData) => uploadAsset(form) } }));
vi.mock('@/hooks/queries', () => ({ useServerConfigQuery: () => ({ data: undefined }) }));

beforeEach(() => {
  uploadAsset.mockReset().mockResolvedValue({ message: 'ok', asset: { id: 'portrait-1' } });
});

const portraitInput = () => {
  const label = screen.getByTitle('Choose a portrait');
  return document.getElementById(label.getAttribute('for')!) as HTMLInputElement;
};
const pick = (file: File) => fireEvent.change(portraitInput(), { target: { files: [file] } });
const saved = () => vi.fn<(data: CharacterData, toast?: boolean, url?: string) => Promise<void>>().mockResolvedValue(undefined);

describe('the portrait in the editor', () => {
  it('is uploaded on save as a token picture and stored in the sheet', async () => {
    const onSave = saved();
    render(<FifthEditionCharacterEditor character={fifthEditionCharacter()} onSave={onSave} onCancel={vi.fn()} />);
    pick(new File([new Uint8Array(10)], 'art.png', { type: 'image/png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());

    expect((uploadAsset.mock.calls[0][0] as FormData).get('type')).toBe('TOKEN');
    expect((onSave.mock.calls[0][0] as { portraitUrl?: string }).portraitUrl).toBe('/api/assets/tokens/portrait-1');
    // No new token picture was chosen, so none is sent.
    expect(onSave.mock.calls[0][2]).toBeUndefined();
  });

  it('refuses a file that is not a picture', async () => {
    render(<FifthEditionCharacterEditor character={fifthEditionCharacter()} onSave={saved()} onCancel={vi.fn()} />);
    pick(new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    expect(await screen.findByText('Please select an image file')).toBeInTheDocument();
  });

  const url = '/api/assets/tokens/stored';

  it('keeps a stored portrait through a save', async () => {
    const onSave = saved();
    render(<FifthEditionCharacterEditor character={fifthEditionCharacter({ portraitUrl: url })} onSave={onSave} onCancel={vi.fn()} />);
    expect(screen.getByAltText('Portrait')).toHaveAttribute('src', url);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect((onSave.mock.calls[0][0] as { portraitUrl?: string }).portraitUrl).toBe(url);
    expect(uploadAsset).not.toHaveBeenCalled();
  });

  it('can be removed', async () => {
    const onSave = saved();
    render(<FifthEditionCharacterEditor character={fifthEditionCharacter({ portraitUrl: url })} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove portrait' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    // Left out of the sheet as it is sent (JSON drops an undefined field).
    expect(JSON.parse(JSON.stringify(onSave.mock.calls[0][0]))).not.toHaveProperty('portraitUrl');
  });

  it('is not offered where the token picture is not', () => {
    render(<FifthEditionCharacterEditor character={fifthEditionCharacter()} onSave={saved()} onCancel={vi.fn()} allowTokenPicture={false} />);
    expect(screen.queryByTitle('Choose a portrait')).toBeNull();
  });
});

describe('the portrait in the read-only header', () => {
  const picture = () => screen.queryByRole('img', { name: 'Aldra' });

  it('shows the sheet portrait over the token picture', () => {
    render(<FifthEditionCharacterView character={{ ...fifthEditionCharacter({ characterName: 'Aldra', portraitUrl: '/api/assets/tokens/p' }), tokenImageUrl: '/api/assets/tokens/t' }} />);
    expect(picture()).toHaveAttribute('src', '/api/assets/tokens/p');
  });

  it('falls back to the token picture', () => {
    render(<FifthEditionCharacterView character={{ ...fifthEditionCharacter({ characterName: 'Aldra' }), tokenImageUrl: '/api/assets/tokens/t' }} />);
    expect(picture()).toHaveAttribute('src', '/api/assets/tokens/t');
  });

  it('draws nothing in its place without either', () => {
    render(<FifthEditionCharacterView character={fifthEditionCharacter({ characterName: 'Aldra' })} />);
    expect(picture()).toBeNull();
  });
});
