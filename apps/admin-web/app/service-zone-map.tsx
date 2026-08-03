'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from 'react';

export type ZoneMapPoint = { latitude: number; longitude: number };
type Viewport = { height: number; width: number };
export type ZoneMapTile = {
  column: number;
  key: string;
  left: number;
  row: number;
  src: string;
  top: number;
};

const tileSize = 256;
const minimumZoom = 5;
const maximumZoom = 18;
const maximumLatitude = 85.05112878;
const defaultViewport = { height: 440, width: 760 };
const emptyViewport = { height: 0, width: 0 };
const dialogTransitionMilliseconds = 420;

const localPlaces = [
  {
    label: 'دمياط الجديدة',
    keywords: 'new damietta مدينة دمياط الجديدة الجامعة',
    point: { latitude: 31.4321, longitude: 31.8273 },
  },
  {
    label: 'وسط دمياط',
    keywords: 'damietta دمياط الأعصر الكورنيش شارع الجلاء',
    point: { latitude: 31.41754, longitude: 31.81444 },
  },
  {
    label: 'رأس البر',
    keywords: 'ras el bar رأس البر اللسان',
    point: { latitude: 31.5114, longitude: 31.8257 },
  },
  {
    label: 'كفر سعد',
    keywords: 'kafr saad كفر سعد',
    point: { latitude: 31.3524, longitude: 31.6844 },
  },
  {
    label: 'فارسكور',
    keywords: 'faraskour فارسكور',
    point: { latitude: 31.3291, longitude: 31.7159 },
  },
  {
    label: 'بورسعيد',
    keywords: 'port said بورسعيد',
    point: { latitude: 31.2653, longitude: 32.3019 },
  },
] as const;

function project(point: ZoneMapPoint, zoom: number) {
  const scale = tileSize * 2 ** zoom;
  const latitude = Math.max(
    -maximumLatitude,
    Math.min(maximumLatitude, point.latitude),
  );
  const sine = Math.sin((latitude * Math.PI) / 180);
  return {
    x: ((point.longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * scale,
  };
}

function unproject(x: number, y: number, zoom: number): ZoneMapPoint {
  const scale = tileSize * 2 ** zoom;
  const wrappedX = ((x % scale) + scale) % scale;
  const clampedY = Math.max(0, Math.min(scale, y));
  const longitude = (wrappedX / scale) * 360 - 180;
  const mercator = Math.PI - (2 * Math.PI * clampedY) / scale;
  const latitude = (180 / Math.PI) * Math.atan(Math.sinh(mercator));
  return {
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
  };
}

function pointAtPosition(
  center: ZoneMapPoint,
  x: number,
  y: number,
  zoom: number,
  viewport: Viewport,
) {
  const projected = project(center, zoom);
  return unproject(
    projected.x - viewport.width / 2 + x,
    projected.y - viewport.height / 2 + y,
    zoom,
  );
}

function positionForPoint(
  center: ZoneMapPoint,
  point: ZoneMapPoint,
  zoom: number,
  viewport: Viewport,
) {
  const scale = tileSize * 2 ** zoom;
  const centerWorld = project(center, zoom);
  const pointWorld = project(point, zoom);
  let deltaX = pointWorld.x - centerWorld.x;
  if (deltaX > scale / 2) deltaX -= scale;
  if (deltaX < -scale / 2) deltaX += scale;
  return {
    x: viewport.width / 2 + deltaX,
    y: viewport.height / 2 + pointWorld.y - centerWorld.y,
  };
}

function panCenter(
  center: ZoneMapPoint,
  deltaX: number,
  deltaY: number,
  zoom: number,
) {
  const projected = project(center, zoom);
  return unproject(projected.x - deltaX, projected.y - deltaY, zoom);
}

export function metersPerPixel(latitude: number, zoom: number) {
  return (156_543.03392 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
}

export function mapZoomForRadius(
  radiusKm: number,
  latitude: number,
  viewport: Viewport = defaultViewport,
) {
  const available = Math.max(
    120,
    Math.min(viewport.width, viewport.height) - 96,
  );
  const numerator =
    available *
    156_543.03392 *
    Math.max(0.05, Math.cos((latitude * Math.PI) / 180));
  const raw = Math.floor(Math.log2(numerator / (radiusKm * 2_000)));
  return Math.max(minimumZoom, Math.min(maximumZoom, raw));
}

export function circleDiameterPixels(
  radiusKm: number,
  latitude: number,
  zoom: number,
) {
  return (radiusKm * 2_000) / metersPerPixel(latitude, zoom);
}

export function resolveLocalZoneSearch(query: string): ZoneMapPoint | null {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return null;
  const coordinateMatch = normalized.match(
    /^(-?\d{1,2}(?:\.\d+)?)\s*[,،]\s*(-?\d{1,3}(?:\.\d+)?)$/,
  );
  if (coordinateMatch) {
    const latitude = Number(coordinateMatch[1]);
    const longitude = Number(coordinateMatch[2]);
    if (
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180
    ) {
      return { latitude, longitude };
    }
  }
  const match = localPlaces.find(
    (place) =>
      place.label.toLowerCase().includes(normalized) ||
      place.keywords.toLowerCase().includes(normalized),
  );
  return match ? { ...match.point } : null;
}

export function mapTilesForViewport(
  center: ZoneMapPoint,
  zoom: number,
  viewport: Viewport,
) {
  const world = project(center, zoom);
  const left = world.x - viewport.width / 2;
  const top = world.y - viewport.height / 2;
  const firstX = Math.floor(left / tileSize);
  const firstY = Math.floor(top / tileSize);
  const lastX = Math.floor((left + viewport.width) / tileSize);
  const lastY = Math.floor((top + viewport.height) / tileSize);
  const count = 2 ** zoom;
  const result: ZoneMapTile[] = [];
  for (let y = firstY; y <= lastY; y += 1) {
    if (y < 0 || y >= count) continue;
    for (let x = firstX; x <= lastX; x += 1) {
      const wrappedX = ((x % count) + count) % count;
      result.push({
        column: x,
        key: `${zoom}/${wrappedX}/${y}`,
        left: x * tileSize - left,
        row: y,
        top: y * tileSize - top,
        src: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png`,
      });
    }
  }
  return result;
}

export function ServiceZoneMap({
  initialPoint,
  initialRadiusKm,
  onCancel,
  onConfirm,
  readOnly = false,
}: {
  initialPoint: ZoneMapPoint;
  initialRadiusKm: number;
  onCancel: () => void;
  onConfirm?: (point: ZoneMapPoint, radiusKm: number) => void;
  readOnly?: boolean;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<
    | {
        lastX: number;
        lastY: number;
        mode: 'map' | 'marker';
        moved: boolean;
        originX: number;
        originY: number;
        pointerId: number;
      }
    | undefined
  >(undefined);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [point, setPoint] = useState(initialPoint);
  const [center, setCenter] = useState(initialPoint);
  const [radiusKm, setRadiusKm] = useState(initialRadiusKm);
  const [zoom, setZoom] = useState(minimumZoom);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const pointRef = useRef(point);
  const radiusRef = useRef(radiusKm);

  useEffect(() => {
    pointRef.current = point;
  }, [point]);

  useEffect(() => {
    radiusRef.current = radiusKm;
  }, [radiusKm]);

  useEffect(() => {
    const node = mapRef.current;
    if (!node) return;
    let firstFrame = 0;
    let secondFrame = 0;
    let transitionTimer = 0;
    let measurementSequence = 0;
    let disposed = false;

    const measure = () => {
      const bounds = node.getBoundingClientRect();
      if (
        !Number.isFinite(bounds.width) ||
        !Number.isFinite(bounds.height) ||
        bounds.width <= 0 ||
        bounds.height <= 0
      ) {
        return null;
      }
      const nextViewport = {
        height: bounds.height,
        width: bounds.width,
      };
      setViewport(nextViewport);
      return nextViewport;
    };

    const cancelScheduledMeasurements = () => {
      if (firstFrame) cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
      window.clearTimeout(transitionTimer);
      firstFrame = 0;
      secondFrame = 0;
      transitionTimer = 0;
    };

    const scheduleMeasurements = () => {
      const sequence = ++measurementSequence;
      cancelScheduledMeasurements();
      measure();

      if (typeof requestAnimationFrame !== 'undefined') {
        firstFrame = requestAnimationFrame(() => {
          if (disposed || sequence !== measurementSequence) return;
          measure();
          secondFrame = requestAnimationFrame(() => {
            if (disposed || sequence !== measurementSequence) return;
            measure();
          });
        });
      }

      transitionTimer = window.setTimeout(() => {
        if (disposed || sequence !== measurementSequence) return;
        const finalViewport = measure();
        if (!finalViewport) return;
        const currentPoint = pointRef.current;
        const currentRadius = radiusRef.current;
        setCenter(currentPoint);
        setZoom(
          mapZoomForRadius(currentRadius, currentPoint.latitude, finalViewport),
        );
      }, dialogTransitionMilliseconds);
    };

    scheduleMeasurements();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(scheduleMeasurements);
    observer?.observe(node);
    window.addEventListener('resize', scheduleMeasurements);
    return () => {
      disposed = true;
      measurementSequence += 1;
      observer?.disconnect();
      window.removeEventListener('resize', scheduleMeasurements);
      cancelScheduledMeasurements();
    };
  }, []);

  const visibleTiles = useMemo(
    () => (viewport ? mapTilesForViewport(center, zoom, viewport) : []),
    [center, viewport, zoom],
  );
  const activeViewport = viewport ?? emptyViewport;
  const marker = positionForPoint(center, point, zoom, activeViewport);
  const circleDiameter = circleDiameterPixels(radiusKm, point.latitude, zoom);
  const layerStyle = viewport
    ? { height: viewport.height, width: viewport.width }
    : undefined;

  function selectPoint(nextPoint: ZoneMapPoint) {
    setPoint(nextPoint);
    setCenter(nextPoint);
    if (viewport) {
      setZoom(mapZoomForRadius(radiusKm, nextPoint.latitude, viewport));
    }
  }

  function updateRadius(nextRadiusKm: number) {
    setRadiusKm(nextRadiusKm);
    setCenter(point);
    if (viewport) {
      setZoom(mapZoomForRadius(nextRadiusKm, point.latitude, viewport));
    }
  }

  function localPosition(clientX: number, clientY: number) {
    const bounds = mapRef.current?.getBoundingClientRect();
    if (!bounds) return null;
    return { x: clientX - bounds.left, y: clientY - bounds.top };
  }

  function beginMap(event: PointerEvent<HTMLDivElement>) {
    if (
      !viewport ||
      readOnly ||
      (event.pointerType === 'mouse' && event.button !== 0)
    ) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      lastX: event.clientX,
      lastY: event.clientY,
      mode: 'map',
      moved: false,
      originX: event.clientX,
      originY: event.clientY,
      pointerId: event.pointerId,
    };
  }

  function beginMarker(event: PointerEvent<HTMLButtonElement>) {
    if (!viewport || readOnly) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      lastX: event.clientX,
      lastY: event.clientY,
      mode: 'marker',
      moved: false,
      originX: event.clientX,
      originY: event.clientY,
      pointerId: event.pointerId,
    };
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!viewport || !active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (
      Math.hypot(
        event.clientX - active.originX,
        event.clientY - active.originY,
      ) > 3
    ) {
      active.moved = true;
    }
    if (active.mode === 'map') {
      setCenter((current) =>
        panCenter(
          current,
          event.clientX - active.lastX,
          event.clientY - active.lastY,
          zoom,
        ),
      );
    } else {
      const position = localPosition(event.clientX, event.clientY);
      if (position) {
        selectPoint(
          pointAtPosition(center, position.x, position.y, zoom, viewport),
        );
      }
    }
    active.lastX = event.clientX;
    active.lastY = event.clientY;
  }

  function end(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!viewport || !active || active.pointerId !== event.pointerId) return;
    if (active.mode === 'map' && !active.moved) {
      const position = localPosition(event.clientX, event.clientY);
      if (position) {
        selectPoint(
          pointAtPosition(center, position.x, position.y, zoom, viewport),
        );
      }
    }
    gesture.current = undefined;
  }

  function wheel(event: WheelEvent<HTMLDivElement>) {
    if (!viewport) return;
    event.preventDefault();
    setZoom((current) =>
      Math.max(
        minimumZoom,
        Math.min(maximumZoom, current + (event.deltaY < 0 ? 1 : -1)),
      ),
    );
  }

  function search() {
    const result = resolveLocalZoneSearch(query);
    if (!result) {
      setMessage(
        'لم يتم العثور على الموقع في البحث المحلي. اكتب مدينة أو حيًا معروفًا، أو أدخل الإحداثيات بصيغة خط العرض، خط الطول.',
      );
      return;
    }
    setMessage('');
    selectPoint(result);
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setMessage('المتصفح لا يدعم تحديد الموقع الحالي.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const result = {
          latitude: coords.latitude,
          longitude: coords.longitude,
        };
        selectPoint(result);
        setMessage('');
      },
      () => setMessage('تعذر قراءة الموقع الحالي. اختر المركز على الخريطة.'),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 8_000 },
    );
  }

  return (
    <div className="zone-map-backdrop" role="presentation">
      <section
        aria-labelledby="zone-map-title"
        aria-modal="true"
        className="zone-map-dialog"
        role="dialog"
      >
        <div className="section-heading">
          <div>
            <p className="kicker">تغطية جغرافية دائرية</p>
            <h2 id="zone-map-title">
              {readOnly ? 'عرض منطقة الخدمة' : 'تحديد مركز المنطقة على الخريطة'}
            </h2>
          </div>
          <button onClick={onCancel} type="button">
            إغلاق
          </button>
        </div>

        {!readOnly && (
          <div className="zone-map-toolbar">
            <label>
              البحث عن مدينة أو حي أو عنوان
              <div className="zone-map-search-row">
                <input
                  list="zone-map-local-places"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="مثال: دمياط الجديدة أو 31.4321, 31.8273"
                  value={query}
                />
                <button onClick={search} type="button">
                  بحث
                </button>
              </div>
              <datalist id="zone-map-local-places">
                {localPlaces.map((place) => (
                  <option key={place.label} value={place.label} />
                ))}
              </datalist>
            </label>
            <label>
              نصف قطر الخدمة بالكيلومتر
              <input
                max="500"
                min="0.1"
                onChange={(event) =>
                  updateRadius(Math.max(0.1, Number(event.target.value)))
                }
                step="0.1"
                type="number"
                value={radiusKm}
              />
            </label>
          </div>
        )}

        <div className="zone-map-actions">
          {!readOnly && (
            <>
              <button
                disabled={!viewport}
                onClick={() => selectPoint(center)}
                type="button"
              >
                استخدام مركز الخريطة الحالي
              </button>
              <button
                disabled={!viewport}
                onClick={useCurrentLocation}
                type="button"
              >
                استخدام موقعي الحالي
              </button>
            </>
          )}
          <button
            disabled={!viewport}
            onClick={() => {
              if (!viewport) return;
              setCenter(point);
              setZoom(mapZoomForRadius(radiusKm, point.latitude, viewport));
            }}
            type="button"
          >
            إظهار دائرة التغطية كاملة
          </button>
        </div>

        <div
          aria-label="خريطة منطقة الخدمة التفاعلية"
          className="zone-map-canvas"
          data-center-latitude={point.latitude}
          data-center-longitude={point.longitude}
          data-map-ready={viewport ? 'true' : 'false'}
          data-radius-km={radiusKm}
          data-tile-count={visibleTiles.length}
          data-viewport-height={viewport?.height ?? 0}
          data-viewport-width={viewport?.width ?? 0}
          onPointerCancel={end}
          onPointerDown={beginMap}
          onPointerMove={move}
          onPointerUp={end}
          onWheel={wheel}
          ref={mapRef}
          role="application"
          tabIndex={0}
        >
          <div
            aria-hidden="true"
            className="zone-map-layer zone-map-tiles"
            style={layerStyle}
          >
            {visibleTiles.map((tile) => (
              <img
                alt=""
                data-tile-column={tile.column}
                data-tile-row={tile.row}
                draggable={false}
                key={tile.key}
                src={tile.src}
                style={{ left: tile.left, top: tile.top }}
              />
            ))}
          </div>
          <div className="zone-map-layer zone-map-overlays" style={layerStyle}>
            <span
              aria-label={`دائرة تغطية بنصف قطر ${radiusKm} كيلومتر`}
              className="zone-radius-circle"
              style={{
                height: circleDiameter,
                left: marker.x,
                top: marker.y,
                width: circleDiameter,
              }}
            />
            <button
              aria-label="اسحب علامة مركز منطقة الخدمة"
              className="zone-center-marker"
              disabled={readOnly || !viewport}
              onPointerDown={beginMarker}
              style={{ left: marker.x, top: marker.y }}
              type="button"
            >
              ●
            </button>
          </div>
          {!viewport && (
            <span className="zone-map-measuring" role="status">
              جارٍ تجهيز الخريطة…
            </span>
          )}
          <a
            className="zone-map-attribution"
            href="https://www.openstreetmap.org/copyright"
            rel="noreferrer"
            target="_blank"
          >
            © OpenStreetMap contributors
          </a>
        </div>

        <div className="zone-map-zoom">
          <button
            disabled={zoom >= maximumZoom}
            onClick={() => setZoom((value) => Math.min(maximumZoom, value + 1))}
            type="button"
          >
            +
          </button>
          <span dir="ltr">Zoom {zoom}</span>
          <button
            disabled={zoom <= minimumZoom}
            onClick={() => setZoom((value) => Math.max(minimumZoom, value - 1))}
            type="button"
          >
            −
          </button>
        </div>

        {message && <p className="notice error">{message}</p>}
        <dl className="zone-coordinate-summary">
          <div>
            <dt>خط العرض</dt>
            <dd dir="ltr">{point.latitude.toFixed(6)}</dd>
          </div>
          <div>
            <dt>خط الطول</dt>
            <dd dir="ltr">{point.longitude.toFixed(6)}</dd>
          </div>
          <div>
            <dt>نصف قطر الخدمة</dt>
            <dd>{radiusKm.toFixed(1)} كم</dd>
          </div>
        </dl>

        <div className="button-row">
          {!readOnly && onConfirm && (
            <button
              className="approve"
              onClick={() => onConfirm(point, radiusKm)}
              type="button"
            >
              تأكيد المركز ونصف القطر
            </button>
          )}
          <button onClick={onCancel} type="button">
            {readOnly ? 'إغلاق' : 'إلغاء'}
          </button>
        </div>
      </section>
    </div>
  );
}
