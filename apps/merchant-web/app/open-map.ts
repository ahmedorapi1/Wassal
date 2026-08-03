export const openMapTileProvider = {
  name: 'OpenStreetMap',
  attribution: '© OpenStreetMap contributors',
  attributionUrl: 'https://www.openstreetmap.org/copyright',
  tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
} as const;

export const mapCanvas = {
  height: 360,
  initialZoom: 14,
  maximumZoom: 19,
  minimumZoom: 5,
  width: 640,
} as const;

const tileSize = 256;
const maximumLatitude = 85.051_128_78;

export type MapPoint = { latitude: number; longitude: number };
export type MapTile = {
  key: string;
  left: number;
  src: string;
  top: number;
};
export type MapViewportSize = { height: number; width: number };
export type MapPickerState = {
  center: MapPoint;
  hasInteracted: boolean;
  initialCenter: MapPoint;
  marker: MapPoint | null;
  zoom: number;
};
export type MapPickerAction =
  | { type: 'clear-marker' }
  | { type: 'move-marker'; point: MapPoint }
  | { type: 'pan'; deltaX: number; deltaY: number }
  | { type: 'recenter'; point: MapPoint; select?: boolean }
  | { type: 'reset-view' }
  | { type: 'suggest-initial-point'; point: MapPoint }
  | {
      type: 'zoom';
      delta: number;
      anchorX: number;
      anchorY: number;
      viewport: MapViewportSize;
    };

function project(point: MapPoint, zoom: number) {
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

function unproject(x: number, y: number, zoom: number): MapPoint {
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

export function tilesForPoint(
  center: MapPoint,
  zoom: number = mapCanvas.initialZoom,
  viewport: MapViewportSize = mapCanvas,
): MapTile[] {
  const centerWorld = project(center, zoom);
  const leftWorld = centerWorld.x - viewport.width / 2;
  const topWorld = centerWorld.y - viewport.height / 2;
  const firstTileX = Math.floor(leftWorld / tileSize);
  const firstTileY = Math.floor(topWorld / tileSize);
  const lastTileX = Math.floor((leftWorld + viewport.width) / tileSize);
  const lastTileY = Math.floor((topWorld + viewport.height) / tileSize);
  const tileCount = 2 ** zoom;
  const tiles: MapTile[] = [];
  for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
    if (tileY < 0 || tileY >= tileCount) continue;
    for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
      const wrappedTileX = ((tileX % tileCount) + tileCount) % tileCount;
      tiles.push({
        key: `${zoom}/${wrappedTileX}/${tileY}`,
        left: tileX * tileSize - leftWorld,
        top: tileY * tileSize - topWorld,
        src: openMapTileProvider.tileUrl
          .replace('{z}', String(zoom))
          .replace('{x}', String(wrappedTileX))
          .replace('{y}', String(tileY)),
      });
    }
  }
  return tiles;
}

export function pointAtCanvasPosition(
  center: MapPoint,
  x: number,
  y: number,
  zoom: number = mapCanvas.initialZoom,
  viewport: MapViewportSize = mapCanvas,
): MapPoint {
  const centerWorld = project(center, zoom);
  return unproject(
    centerWorld.x - viewport.width / 2 + x,
    centerWorld.y - viewport.height / 2 + y,
    zoom,
  );
}

export function canvasPositionForPoint(
  center: MapPoint,
  point: MapPoint,
  zoom: number = mapCanvas.initialZoom,
  viewport: MapViewportSize = mapCanvas,
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

export function panMapCenter(
  center: MapPoint,
  deltaX: number,
  deltaY: number,
  zoom: number = mapCanvas.initialZoom,
): MapPoint {
  const centerWorld = project(center, zoom);
  return unproject(centerWorld.x - deltaX, centerWorld.y - deltaY, zoom);
}

export function zoomMapCenter(
  center: MapPoint,
  currentZoom: number,
  nextZoom: number,
  anchorX: number,
  anchorY: number,
  viewport: MapViewportSize = mapCanvas,
): MapPoint {
  const anchorPoint = pointAtCanvasPosition(
    center,
    anchorX,
    anchorY,
    currentZoom,
    viewport,
  );
  const anchorWorld = project(anchorPoint, nextZoom);
  return unproject(
    anchorWorld.x - (anchorX - viewport.width / 2),
    anchorWorld.y - (anchorY - viewport.height / 2),
    nextZoom,
  );
}

export function createMapPickerState(initialPoint: MapPoint): MapPickerState {
  return {
    center: initialPoint,
    hasInteracted: false,
    initialCenter: initialPoint,
    marker: initialPoint,
    zoom: mapCanvas.initialZoom,
  };
}

export function mapPickerReducer(
  state: MapPickerState,
  action: MapPickerAction,
): MapPickerState {
  switch (action.type) {
    case 'clear-marker':
      return { ...state, hasInteracted: true, marker: null };
    case 'move-marker':
      return { ...state, hasInteracted: true, marker: action.point };
    case 'pan':
      return {
        ...state,
        center: panMapCenter(
          state.center,
          action.deltaX,
          action.deltaY,
          state.zoom,
        ),
        hasInteracted: true,
      };
    case 'recenter':
      return {
        ...state,
        center: action.point,
        hasInteracted: true,
        marker: action.select ? action.point : state.marker,
      };
    case 'reset-view':
      return {
        ...state,
        center: state.initialCenter,
        hasInteracted: true,
        zoom: mapCanvas.initialZoom,
      };
    case 'suggest-initial-point':
      return state.hasInteracted
        ? state
        : {
            ...state,
            center: action.point,
            initialCenter: action.point,
            marker: action.point,
          };
    case 'zoom': {
      const zoom = Math.max(
        mapCanvas.minimumZoom,
        Math.min(mapCanvas.maximumZoom, state.zoom + action.delta),
      );
      if (zoom === state.zoom) return state;
      return {
        ...state,
        center: zoomMapCenter(
          state.center,
          state.zoom,
          zoom,
          action.anchorX,
          action.anchorY,
          action.viewport,
        ),
        hasInteracted: true,
        zoom,
      };
    }
  }
}

export function googleMapsUrl(point: MapPoint) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${point.latitude},${point.longitude}`,
  )}`;
}

export function googleMapsSearchUrl(query: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    query.trim(),
  )}`;
}
