// ============================================
// MapGridPreview
// Renders the selected map image with a grid overlay so the GM
// can verify their Width/Height/GridSize settings line up with
// any existing grid baked into the image. Create Map and Edit Map
// both draw it.
//
// It draws in a 280 by 280 space of CSS pixels, held at the ratio
// the map's own canvases use (effectiveDpr), so the picture and the
// lines are sharp on a phone or a high-density screen.
// ============================================

import { useEffect, useRef } from 'react';
import { effectiveDpr } from './map/layerCanvas';
import { drawGrid } from './map/layers/drawGrid';

const PREVIEW_PX = 280;

export default function MapGridPreview({
  imageUrl,
  width,
  height,
  gridSize,
  zoom,
  gridType = 'square',
  gridOffsetX = 0,
  gridOffsetY = 0,
}: {
  imageUrl: string | null;
  width: number;
  height: number;
  gridSize: number;
  zoom: number;
  /** The grid as the map draws it (map/layers/drawGrid.ts): squares or hexes, from its offset. */
  gridType?: string;
  gridOffsetX?: number;
  gridOffsetY?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dpr = effectiveDpr(window.devicePixelRatio, PREVIEW_PX, PREVIEW_PX);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear with parchment background
    ctx.clearRect(0, 0, PREVIEW_PX, PREVIEW_PX);
    ctx.fillStyle = '#E8E0D0';
    ctx.fillRect(0, 0, PREVIEW_PX, PREVIEW_PX);

    if (!imageUrl) {
      ctx.fillStyle = '#9C8E7A';
      ctx.font = '13px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Select a map image', PREVIEW_PX / 2, PREVIEW_PX / 2 - 10);
      ctx.fillText('to preview the grid', PREVIEW_PX / 2, PREVIEW_PX / 2 + 10);
      return;
    }

    const mapPixelW = width * gridSize;
    const mapPixelH = height * gridSize;

    // Scale the entire map to fit inside PREVIEW_PX, then apply zoom on top
    const baseScale = Math.min(PREVIEW_PX / mapPixelW, PREVIEW_PX / mapPixelH);
    const scale = baseScale * zoom;

    const drawW = mapPixelW * scale;
    const drawH = mapPixelH * scale;
    // Center the scaled map in the preview canvas
    const offsetX = (PREVIEW_PX - drawW) / 2;
    const offsetY = (PREVIEW_PX - drawH) / 2;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!canvasRef.current) return;
      const c = canvasRef.current;
      const cx = c.getContext('2d');
      if (!cx) return;
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Redraw background (image load is async; state may have changed by now)
      cx.clearRect(0, 0, PREVIEW_PX, PREVIEW_PX);
      cx.fillStyle = '#E8E0D0';
      cx.fillRect(0, 0, PREVIEW_PX, PREVIEW_PX);

      // Map image
      cx.drawImage(img, offsetX, offsetY, drawW, drawH);

      // The grid the map draws, in map pixels scaled onto the preview and
      // kept within the map's bounds, so lines don't bleed outside
      cx.save();
      cx.beginPath();
      cx.rect(offsetX, offsetY, drawW, drawH);
      cx.clip();
      cx.translate(offsetX, offsetY);
      cx.scale(scale, scale);
      drawGrid(cx, { gridColor: 'black' }, {
        zoom: scale * 2, panOffset: { x: 0, y: 0 }, gridSize, mapWidth: width, mapHeight: height, gridType, gridOffsetX, gridOffsetY,
      });
      cx.restore();
    };
    img.src = imageUrl;
  }, [imageUrl, width, height, gridSize, zoom, dpr, gridType, gridOffsetX, gridOffsetY]);

  return (
    <canvas
      ref={canvasRef}
      width={Math.floor(PREVIEW_PX * dpr)}
      height={Math.floor(PREVIEW_PX * dpr)}
      className="w-full rounded-sm border border-moss-green/30 bg-parchment/50"
      style={{ aspectRatio: '1 / 1' }}
      aria-label="Grid alignment preview"
    />
  );
}
