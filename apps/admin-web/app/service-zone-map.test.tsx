import { readFileSync } from 'node:fs';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  circleDiameterPixels,
  mapTilesForViewport,
  mapZoomForRadius,
  resolveLocalZoneSearch,
  ServiceZoneMap,
} from './service-zone-map';

describe('Admin service-zone map', () => {
  it('fits the full 25 km circle inside the default viewport', () => {
    const zoom = mapZoomForRadius(25, 31.4321);
    const diameter = circleDiameterPixels(25, 31.4321, zoom);
    expect(zoom).toBeGreaterThanOrEqual(5);
    expect(diameter).toBeLessThanOrEqual(344);
    expect(diameter).toBeGreaterThan(100);
  });

  it('updates circle size when the service radius changes', () => {
    const zoom = 10;
    expect(circleDiameterPixels(35, 31.4321, zoom)).toBeGreaterThan(
      circleDiameterPixels(25, 31.4321, zoom),
    );
  });

  it('fits the complete circle inside a tablet-sized map viewport', () => {
    const viewport = { width: 700, height: 360 };
    const zoom = mapZoomForRadius(35, 31.4321, viewport);
    const diameter = circleDiameterPixels(35, 31.4321, zoom);

    expect(diameter).toBeLessThanOrEqual(
      Math.min(viewport.width, viewport.height) - 96,
    );
    expect(diameter).toBeGreaterThan(60);
  });

  it('renders every tile row and column required to cover the measured viewport', () => {
    const viewport = { width: 1_080, height: 512 };
    const renderedTiles = mapTilesForViewport(
      { latitude: 31.41, longitude: 31.825 },
      9,
      viewport,
    );
    const columnStarts = [
      ...new Set(renderedTiles.map((tile) => tile.left)),
    ].sort((left, right) => left - right);
    const rowStarts = [...new Set(renderedTiles.map((tile) => tile.top))].sort(
      (top, bottom) => top - bottom,
    );

    expect(columnStarts[0]).toBeLessThanOrEqual(0);
    expect(columnStarts.at(-1)! + 256).toBeGreaterThanOrEqual(viewport.width);
    expect(rowStarts[0]).toBeLessThanOrEqual(0);
    expect(rowStarts.at(-1)! + 256).toBeGreaterThanOrEqual(viewport.height);
    expect(
      columnStarts
        .slice(1)
        .every((value, index) => value - columnStarts[index]! === 256),
    ).toBe(true);
    expect(
      rowStarts
        .slice(1)
        .every((value, index) => value - rowStarts[index]! === 256),
    ).toBe(true);
  });

  it('keeps tile positioning LTR and layers aligned to the measured canvas', () => {
    const styles = readFileSync(
      new URL('./styles.css', import.meta.url),
      'utf8',
    );
    const source = readFileSync(
      new URL('./service-zone-map.tsx', import.meta.url),
      'utf8',
    );

    expect(styles).toMatch(
      /\.zone-map-layer\s*\{[^}]*direction:\s*ltr;[^}]*left:\s*0;/s,
    );
    expect(styles).toMatch(/\.zone-map-tiles img\s*\{[^}]*inset:\s*auto;/s);
    expect(styles).toContain('height: clamp(360px, 55vh, 620px);');
    expect(
      source.match(/requestAnimationFrame/g)?.length,
    ).toBeGreaterThanOrEqual(2);
    expect(source).toContain('getBoundingClientRect()');
    expect(source).toContain('new ResizeObserver(scheduleMeasurements)');
    expect(source).toContain(
      "window.addEventListener('resize', scheduleMeasurements)",
    );
  });

  it('resolves local city, district, and coordinate searches', () => {
    expect(resolveLocalZoneSearch('دمياط الجديدة')).toEqual({
      latitude: 31.4321,
      longitude: 31.8273,
    });
    expect(resolveLocalZoneSearch('الكورنيش')).toEqual({
      latitude: 31.41754,
      longitude: 31.81444,
    });
    expect(resolveLocalZoneSearch('31.5, 31.8')).toEqual({
      latitude: 31.5,
      longitude: 31.8,
    });
  });

  it('renders a shaded radius, marker, and read-only coordinates', () => {
    const html = renderToStaticMarkup(
      createElement(ServiceZoneMap, {
        initialPoint: { latitude: 31.4321, longitude: 31.8273 },
        initialRadiusKm: 25,
        onCancel: () => undefined,
        onConfirm: () => undefined,
      }),
    );
    expect(html).toContain('zone-radius-circle');
    expect(html).toContain('zone-center-marker');
    expect(html).toContain('تحديد مركز المنطقة على الخريطة');
    expect(html).toContain('25.0 كم');
  });
});
