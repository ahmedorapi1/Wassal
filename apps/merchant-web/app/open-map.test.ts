import { describe, expect, it } from 'vitest';

import {
  canvasPositionForPoint,
  createMapPickerState,
  googleMapsSearchUrl,
  googleMapsUrl,
  mapCanvas,
  mapPickerReducer,
  panMapCenter,
  pointAtCanvasPosition,
  tilesForPoint,
} from './open-map';

describe('zero-cost merchant map projection', () => {
  const center = { latitude: 31.4321, longitude: 31.8273 };

  it('maps the canvas center back to the exact selected point', () => {
    expect(
      pointAtCanvasPosition(center, mapCanvas.width / 2, mapCanvas.height / 2),
    ).toEqual(center);
  });

  it('pans far away from the store without moving or constraining the marker', () => {
    const initial = createMapPickerState(center);
    const panned = mapPickerReducer(initial, {
      type: 'pan',
      deltaX: -4_000,
      deltaY: 2_000,
    });
    expect(
      Math.abs(panned.center.longitude - center.longitude),
    ).toBeGreaterThan(0.1);
    expect(panned.marker).toEqual(center);
  });

  it('zooms out to the city scale and selects a distant visible point', () => {
    let state = createMapPickerState(center);
    for (let index = 0; index < 4; index += 1) {
      state = mapPickerReducer(state, {
        type: 'zoom',
        delta: -1,
        anchorX: mapCanvas.width / 2,
        anchorY: mapCanvas.height / 2,
        viewport: mapCanvas,
      });
    }
    const distant = pointAtCanvasPosition(
      state.center,
      mapCanvas.width - 10,
      10,
      state.zoom,
    );
    state = mapPickerReducer(state, {
      type: 'move-marker',
      point: distant,
    });
    expect(state.zoom).toBe(10);
    expect(Math.abs(distant.longitude - center.longitude)).toBeGreaterThan(0.1);
    expect(state.marker).toEqual(distant);
  });

  it('preserves the marker coordinates while panning and zooming', () => {
    const selected = { latitude: 31.49, longitude: 31.72 };
    let state = mapPickerReducer(createMapPickerState(center), {
      type: 'move-marker',
      point: selected,
    });
    state = mapPickerReducer(state, {
      type: 'pan',
      deltaX: 800,
      deltaY: -400,
    });
    state = mapPickerReducer(state, {
      type: 'zoom',
      delta: -2,
      anchorX: 120,
      anchorY: 80,
      viewport: mapCanvas,
    });
    expect(state.marker).toEqual(selected);
    expect(
      canvasPositionForPoint(
        state.center,
        state.marker!,
        state.zoom,
        mapCanvas,
      ),
    ).toEqual(expect.objectContaining({ x: expect.any(Number) }));
  });

  it('does not auto-recenter after the merchant has interacted', () => {
    const interacted = mapPickerReducer(createMapPickerState(center), {
      type: 'pan',
      deltaX: 700,
      deltaY: 0,
    });
    const suggested = mapPickerReducer(interacted, {
      type: 'suggest-initial-point',
      point: { latitude: 31.41, longitude: 31.81 },
    });
    expect(suggested).toEqual(interacted);
  });

  it('supports panning in either direction with no store-radius clamp', () => {
    const west = panMapCenter(center, 12_000, 0);
    const east = panMapCenter(center, -12_000, 0);
    expect(west.longitude).toBeLessThan(center.longitude);
    expect(east.longitude).toBeGreaterThan(center.longitude);
  });

  it('moves the point when the merchant clicks elsewhere', () => {
    expect(pointAtCanvasPosition(center, mapCanvas.width - 40, 40)).not.toEqual(
      center,
    );
  });

  it('builds attributed HTTPS OpenStreetMap tiles and an external preview', () => {
    const tiles = tilesForPoint(center);
    expect(tiles.length).toBeGreaterThan(4);
    expect(tiles.every(({ src }) => src.startsWith('https://'))).toBe(true);
    expect(googleMapsUrl(center)).toContain('31.4321%2C31.8273');
    expect(googleMapsSearchUrl('شارع الجلاء دمياط')).toContain(
      encodeURIComponent('شارع الجلاء دمياط'),
    );
  });
});
