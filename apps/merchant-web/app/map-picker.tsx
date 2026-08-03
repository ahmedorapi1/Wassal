'use client';

import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent,
  type RefObject,
  type WheelEvent,
} from 'react';

import {
  canvasPositionForPoint,
  createMapPickerState,
  googleMapsSearchUrl,
  googleMapsUrl,
  mapCanvas,
  mapPickerReducer,
  openMapTileProvider,
  pointAtCanvasPosition,
  tilesForPoint,
  type MapPoint,
  type MapViewportSize,
} from './open-map';

function useMapSize(
  element: RefObject<HTMLDivElement | null>,
  fallback: MapViewportSize,
) {
  const [size, setSize] = useState(fallback);
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const update = () => {
      const bounds = node.getBoundingClientRect();
      if (bounds.width > 0 && bounds.height > 0) {
        setSize((current) =>
          current.width === bounds.width && current.height === bounds.height
            ? current
            : { width: bounds.width, height: bounds.height },
        );
      }
    };
    update();
    let firstFrame = 0;
    let secondFrame = 0;
    if (typeof requestAnimationFrame !== 'undefined') {
      firstFrame = requestAnimationFrame(() => {
        update();
        secondFrame = requestAnimationFrame(update);
      });
    }
    const animationTimer = window.setTimeout(update, 240);
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(update);
    observer?.observe(node);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      window.clearTimeout(animationTimer);
      if (firstFrame) cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [element]);
  return size;
}

export function OpenMapPreview({ point }: { point: MapPoint }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const viewport = useMapSize(mapRef, { width: 384, height: 190 });
  const tiles = useMemo(
    () => tilesForPoint(point, mapCanvas.initialZoom, viewport),
    [point, viewport],
  );
  return (
    <div
      aria-label="معاينة موقع العميل"
      className="open-map open-map-preview"
      ref={mapRef}
    >
      <div className="open-map-tiles" aria-hidden="true">
        {tiles.map((tile) => (
          <img
            alt=""
            draggable={false}
            key={tile.key}
            src={tile.src}
            style={{ left: tile.left, top: tile.top }}
          />
        ))}
      </div>
      <span className="map-marker map-marker-preview" aria-hidden="true">
        ●
      </span>
      <a
        className="map-attribution"
        href={openMapTileProvider.attributionUrl}
        rel="noreferrer"
        target="_blank"
      >
        {openMapTileProvider.attribution}
      </a>
    </div>
  );
}

type Gesture = {
  lastX: number;
  lastY: number;
  mode: 'marker' | 'pan';
  moved: boolean;
  originX: number;
  originY: number;
  pointerId: number;
};

export function MapPicker({
  guidance,
  initialPoint,
  onCancel,
  onConfirm,
  storePoint,
  title = 'اختيار موقع العميل على الخريطة',
}: {
  guidance?: string;
  initialPoint: MapPoint;
  onCancel: () => void;
  onConfirm: (point: MapPoint) => Promise<void>;
  storePoint?: MapPoint;
  title?: string;
}) {
  const [state, dispatch] = useReducer(
    mapPickerReducer,
    initialPoint,
    createMapPickerState,
  );
  const [busy, setBusy] = useState(false);
  const [mapMessage, setMapMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const mapRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | undefined>(undefined);
  const viewport = useMapSize(mapRef, mapCanvas);
  const tiles = useMemo(
    () => tilesForPoint(state.center, state.zoom, viewport),
    [state.center, state.zoom, viewport],
  );
  const markerPosition = state.marker
    ? canvasPositionForPoint(state.center, state.marker, state.zoom, viewport)
    : null;

  useEffect(() => {
    dispatch({ type: 'suggest-initial-point', point: initialPoint });
  }, [initialPoint]);

  useEffect(() => {
    const recenterTimer = window.setTimeout(() => {
      dispatch({ type: 'suggest-initial-point', point: initialPoint });
    }, 240);
    return () => window.clearTimeout(recenterTimer);
  }, [initialPoint]);

  function localPosition(clientX: number, clientY: number) {
    const bounds = mapRef.current?.getBoundingClientRect();
    if (!bounds) return null;
    return {
      x: clientX - bounds.left,
      y: clientY - bounds.top,
    };
  }

  function beginPan(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      lastX: event.clientX,
      lastY: event.clientY,
      mode: 'pan',
      moved: false,
      originX: event.clientX,
      originY: event.clientY,
      pointerId: event.pointerId,
    };
  }

  function beginMarkerDrag(event: PointerEvent<HTMLButtonElement>) {
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

  function movePointer(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    const distance = Math.hypot(
      event.clientX - active.originX,
      event.clientY - active.originY,
    );
    if (distance >= 3) active.moved = true;

    if (active.mode === 'pan') {
      const deltaX = event.clientX - active.lastX;
      const deltaY = event.clientY - active.lastY;
      if (deltaX || deltaY) {
        dispatch({ type: 'pan', deltaX, deltaY });
      }
    } else {
      const position = localPosition(event.clientX, event.clientY);
      if (position) {
        dispatch({
          type: 'move-marker',
          point: pointAtCanvasPosition(
            state.center,
            position.x,
            position.y,
            state.zoom,
            viewport,
          ),
        });
      }
    }
    active.lastX = event.clientX;
    active.lastY = event.clientY;
  }

  function endPointer(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.mode === 'pan' && !active.moved) {
      const position = localPosition(event.clientX, event.clientY);
      if (position) {
        dispatch({
          type: 'move-marker',
          point: pointAtCanvasPosition(
            state.center,
            position.x,
            position.y,
            state.zoom,
            viewport,
          ),
        });
      }
    }
    gesture.current = undefined;
  }

  function zoom(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const position = localPosition(event.clientX, event.clientY);
    if (!position) return;
    dispatch({
      type: 'zoom',
      delta: event.deltaY < 0 ? 1 : -1,
      anchorX: position.x,
      anchorY: position.y,
      viewport,
    });
  }

  function zoomBy(delta: number) {
    dispatch({
      type: 'zoom',
      delta,
      anchorX: viewport.width / 2,
      anchorY: viewport.height / 2,
      viewport,
    });
  }

  function useCurrentLocation() {
    setMapMessage('');
    if (!navigator.geolocation) {
      setMapMessage('هذا المتصفح لا يدعم تحديد الموقع.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) =>
        dispatch({
          type: 'recenter',
          point: {
            latitude: coords.latitude,
            longitude: coords.longitude,
          },
          select: true,
        }),
      () =>
        setMapMessage(
          'تعذر تحديد موقعك الحالي. يمكنك تحريك الخريطة ووضع العلامة يدوياً.',
        ),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 8_000 },
    );
  }

  function searchAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchQuery.trim();
    if (!query) {
      setMapMessage('اكتب عنواناً للبحث أولاً.');
      return;
    }
    window.open(googleMapsSearchUrl(query), '_blank', 'noopener,noreferrer');
    setMapMessage(
      'فُتح البحث في Google Maps. بعد اختيار المكان انسخ رابطه والصقه في نموذج العنوان ثم راجع العلامة.',
    );
  }

  async function confirm() {
    if (!state.marker) return;
    setBusy(true);
    try {
      await onConfirm(state.marker);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="map-dialog-backdrop" role="presentation">
      <section
        aria-labelledby="map-picker-title"
        aria-modal="true"
        className="map-dialog"
        role="dialog"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">موقع تسليم لمرة واحدة</p>
            <h2 id="map-picker-title">{title}</h2>
          </div>
          <button className="text-button" onClick={onCancel} type="button">
            إلغاء
          </button>
        </div>
        {guidance && <p className="notice">{guidance}</p>}
        <p>
          اسحب الخريطة في أي اتجاه، واستخدم عجلة الفأرة أو زري التكبير، ثم اضغط
          في أي نقطة أو اسحب العلامة نفسها.
        </p>
        <div className="map-toolbar">
          <form className="map-search" onSubmit={searchAddress}>
            <label>
              البحث عن عنوان — اختياري
              <input
                placeholder="مثال: شارع الجلاء، دمياط"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </label>
            <button className="secondary" type="submit">
              فتح البحث في Google Maps
            </button>
          </form>
          <div className="map-control-row">
            <button
              disabled={!storePoint}
              onClick={() =>
                storePoint && dispatch({ type: 'recenter', point: storePoint })
              }
              type="button"
            >
              موقع المتجر
            </button>
            <button onClick={useCurrentLocation} type="button">
              موقعي الحالي
            </button>
            <button
              disabled={!state.marker}
              onClick={() =>
                state.marker &&
                dispatch({ type: 'recenter', point: state.marker })
              }
              type="button"
            >
              موقع العميل المحدد
            </button>
          </div>
        </div>
        <div
          aria-label="خريطة تفاعلية لتحديد موقع العميل"
          className="open-map open-map-picker"
          onPointerCancel={endPointer}
          onPointerDown={beginPan}
          onPointerMove={movePointer}
          onPointerUp={endPointer}
          onWheel={zoom}
          ref={mapRef}
          role="application"
          tabIndex={0}
        >
          <span className="open-map-tiles" aria-hidden="true">
            {tiles.map((tile) => (
              <img
                alt=""
                draggable={false}
                key={tile.key}
                src={tile.src}
                style={{ left: tile.left, top: tile.top }}
              />
            ))}
          </span>
          {markerPosition && (
            <button
              aria-label="اسحب علامة موقع العميل"
              className="map-marker map-marker-draggable"
              onPointerDown={beginMarkerDrag}
              style={{
                left: markerPosition.x,
                top: markerPosition.y,
              }}
              type="button"
            >
              ●
            </button>
          )}
          <a
            className="map-attribution"
            href={openMapTileProvider.attributionUrl}
            onPointerDown={(event) => event.stopPropagation()}
            rel="noreferrer"
            target="_blank"
          >
            {openMapTileProvider.attribution}
          </a>
        </div>
        <div className="map-control-row map-zoom-controls">
          <button
            aria-label="تكبير الخريطة"
            disabled={state.zoom >= mapCanvas.maximumZoom}
            onClick={() => zoomBy(1)}
            type="button"
          >
            +
          </button>
          <span dir="ltr">Zoom {state.zoom}</span>
          <button
            aria-label="تصغير الخريطة"
            disabled={state.zoom <= mapCanvas.minimumZoom}
            onClick={() => zoomBy(-1)}
            type="button"
          >
            −
          </button>
          <button
            onClick={() => dispatch({ type: 'reset-view' })}
            type="button"
          >
            إعادة ضبط العرض
          </button>
        </div>
        {mapMessage && <p className="notice error">{mapMessage}</p>}
        <div className="advanced-coordinate-summary" dir="ltr">
          {state.marker
            ? `${state.marker.latitude.toFixed(6)}, ${state.marker.longitude.toFixed(6)}`
            : 'No location selected'}
        </div>
        <div className="button-row">
          <button
            className="primary"
            disabled={busy || !state.marker}
            onClick={() => void confirm()}
            type="button"
          >
            تأكيد الموقع
          </button>
          <button
            className="secondary"
            onClick={() => dispatch({ type: 'clear-marker' })}
            type="button"
          >
            مسح الموقع
          </button>
          <button className="secondary" onClick={onCancel} type="button">
            إلغاء
          </button>
          {state.marker && (
            <a
              className="secondary map-external-link"
              href={googleMapsUrl(state.marker)}
              rel="noreferrer"
              target="_blank"
            >
              فتح المعاينة الخارجية
            </a>
          )}
        </div>
      </section>
    </div>
  );
}
