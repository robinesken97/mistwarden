import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TokenLightField from '../TokenLightField';

const torch = { brightRadius: 4, dimRadius: 8, color: '#ffcc66', enabled: true };

describe('TokenLightField', () => {
  it('lights a torch when switched on, and puts it out keeping its settings', () => {
    const onChange = vi.fn();
    const { rerender } = render(<TokenLightField value={null} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Carries a light'));
    expect(onChange).toHaveBeenLastCalledWith(torch);

    rerender(<TokenLightField value={{ ...torch, color: '#66aaff' }} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Carries a light'));
    expect(onChange).toHaveBeenLastCalledWith({ ...torch, color: '#66aaff', enabled: false });
  });

  it('sets a preset in one change', () => {
    const onChange = vi.fn();
    render(<TokenLightField value={torch} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Lantern' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...torch, brightRadius: 6, dimRadius: 12 });
  });

  it('keeps dim at least bright, as the server requires, and saves a radius once on blur', () => {
    const onChange = vi.fn();
    render(<TokenLightField value={torch} onChange={onChange} />);
    const bright = screen.getByLabelText('Bright light radius in grid squares');
    fireEvent.change(bright, { target: { value: '1' } });
    fireEvent.change(bright, { target: { value: '10' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(bright);
    expect(onChange.mock.calls).toEqual([[{ ...torch, brightRadius: 10, dimRadius: 10 }]]);
  });
});
