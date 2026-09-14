import L from 'leaflet';
import { useEffect, useState } from 'react';
import { CircleMarker, MapContainer, Marker, Popup, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type MapPoint = {
  lat: number;
  lng: number;
};

export type MapSelectionMode = 'pickup' | 'destination';

const DALOA_CENTER: LatLngExpression = [6.877, -6.45];

const pickupIcon = L.divIcon({
  className: 'daloago-map-marker daloago-map-marker-pickup',
  html: '<span></span>',
  iconSize: [38, 46],
  iconAnchor: [19, 46],
});

const destinationIcon = L.divIcon({
  className: 'daloago-map-marker daloago-map-marker-destination',
  html: '<span></span>',
  iconSize: [38, 46],
  iconAnchor: [19, 46],
});

const ROUTING_ENDPOINT = 'https://router.project-osrm.org/route/v1/driving';

type RouteCoordinate = [number, number];

type RouteData = {
  coordinates: RouteCoordinate[];
  distanceMeters: number;
  durationSeconds: number;
};

type RouteResponse = {
  code?: string;
  routes?: Array<{
    distance: number;
    duration: number;
    geometry?: {
      coordinates?: Array<[number, number]>;
    };
  }>;
};

function MapInteraction({ onSelect }: { onSelect: (point: MapPoint) => void }) {
  useMapEvents({
    click: (event) => onSelect({ lat: event.latlng.lat, lng: event.latlng.lng }),
  });
  return null;
}

function RecenterMap({ point }: { point?: MapPoint }) {
  const map = useMap();
  useEffect(() => {
    if (point) map.flyTo([point.lat, point.lng], Math.max(map.getZoom(), 15), { duration: 0.7 });
  }, [map, point]);
  return null;
}

function RouteLayer({ route }: { route?: RouteData }) {
  const map = useMap();

  useEffect(() => {
    if (!route) return;
    map.fitBounds(route.coordinates, { padding: [56, 56], maxZoom: 16, animate: true });
  }, [map, route]);

  if (!route) return null;

  return <Polyline positions={route.coordinates} pathOptions={{ color: '#1f7358', weight: 6, opacity: 0.88, lineCap: 'round', lineJoin: 'round' }} />;
}

function formatDistance(distanceMeters: number) {
  if (distanceMeters < 1000) return `${Math.round(distanceMeters)} m`;
  return `${(distanceMeters / 1000).toFixed(1).replace('.', ',')} km`;
}

function formatDuration(durationSeconds: number) {
  const minutes = Math.max(1, Math.round(durationSeconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours} h ${remainingMinutes} min` : `${hours} h`;
}

type RealMapProps = {
  pickup?: MapPoint;
  destination?: MapPoint;
  userLocation?: MapPoint;
  mode: MapSelectionMode;
  locationStatus: string;
  onSelect?: (point: MapPoint) => void;
  onModeChange: (mode: MapSelectionMode) => void;
  onLocate: () => void;
  showSelectionControls?: boolean;
  showLocateControl?: boolean;
};

export function RealMap({ pickup, destination, userLocation, mode, locationStatus, onSelect, onModeChange, onLocate, showSelectionControls = true, showLocateControl = true }: RealMapProps) {
  const [route, setRoute] = useState<RouteData>();
  const [routeStatus, setRouteStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  useEffect(() => {
    if (!pickup || !destination) {
      setRoute(undefined);
      setRouteStatus('idle');
      return;
    }

    const controller = new AbortController();
    const coordinates = `${pickup.lng},${pickup.lat};${destination.lng},${destination.lat}`;
    setRoute(undefined);
    setRouteStatus('loading');

    fetch(`${ROUTING_ENDPOINT}/${coordinates}?overview=full&geometries=geojson&steps=false`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Routing request failed with ${response.status}`);
        return response.json() as Promise<RouteResponse>;
      })
      .then((data) => {
        const selectedRoute = data.routes?.[0];
        const coordinates = selectedRoute?.geometry?.coordinates;
        if (data.code !== 'Ok' || !selectedRoute || !coordinates || coordinates.length < 2) {
          throw new Error('No route returned');
        }

        setRoute({
          coordinates: coordinates.map(([lng, lat]) => [lat, lng]),
          distanceMeters: selectedRoute.distance,
          durationSeconds: selectedRoute.duration,
        });
        setRouteStatus('ready');
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setRoute(undefined);
        setRouteStatus('error');
      });

    return () => controller.abort();
  }, [pickup, destination]);

  const routeMessage = routeStatus === 'loading'
    ? 'Calcul de l’itinéraire…'
    : routeStatus === 'error'
      ? 'Itinéraire indisponible pour ces points'
      : routeStatus === 'ready'
        ? 'Itinéraire calculé'
        : pickup && destination
          ? 'Itinéraire en attente'
          : locationStatus;

  return (
    <div className="real-map relative h-[400px] overflow-hidden rounded-[24px] border border-border md:h-[520px]" data-testid="map-trip">
      <MapContainer center={DALOA_CENTER} zoom={14} scrollWheelZoom className="h-full w-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {showSelectionControls && onSelect && <MapInteraction onSelect={onSelect} />}
        {userLocation && <><CircleMarker center={[userLocation.lat, userLocation.lng]} radius={8} pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#1f7358', fillOpacity: 1 }}><Popup>Votre position actuelle</Popup></CircleMarker><RecenterMap point={userLocation} /></>}
        <RouteLayer route={route} />
        {pickup && <Marker position={[pickup.lat, pickup.lng]} icon={pickupIcon}><Popup>Point de départ</Popup></Marker>}
        {destination && <Marker position={[destination.lat, destination.lng]} icon={destinationIcon}><Popup>Destination</Popup></Marker>}
      </MapContainer>
      {(showSelectionControls || showLocateControl) && <div className="pointer-events-none absolute inset-x-3 top-3 z-[1000] flex items-center gap-2">
        {showSelectionControls && <div className="pointer-events-auto flex min-w-0 flex-1 rounded-xl border border-border/70 bg-card/95 p-1 shadow-lg backdrop-blur">
          <button type="button" onClick={() => onModeChange('pickup')} className={`min-w-0 flex-1 rounded-lg px-2 py-2 text-[11px] font-bold transition-colors ${mode === 'pickup' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted'}`}>Départ</button>
          <button type="button" onClick={() => onModeChange('destination')} className={`min-w-0 flex-1 rounded-lg px-2 py-2 text-[11px] font-bold transition-colors ${mode === 'destination' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>Destination</button>
        </div>}
        {showLocateControl && <button type="button" onClick={onLocate} className="pointer-events-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-card/95 text-primary shadow-lg backdrop-blur hover:bg-muted" aria-label="Utiliser ma position" data-testid="button-geolocate"><span className="text-lg">⌖</span></button>}
      </div>}
      <div className="pointer-events-none absolute bottom-3 left-3 right-3 z-[1000] flex items-center justify-between gap-3 rounded-2xl border border-card/60 bg-card/95 p-3 shadow-lg backdrop-blur">
        <div className="flex min-w-0 items-center gap-2"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${userLocation ? 'pulse-dot bg-primary' : 'bg-secondary'}`} /><span className="truncate text-xs font-bold">{routeMessage}</span></div>
        {route && <span className="shrink-0 rounded-full bg-secondary/20 px-2 py-1 text-[11px] font-bold text-primary">{formatDistance(route.distanceMeters)} · {formatDuration(route.durationSeconds)}</span>}
        <span className="hidden shrink-0 text-[10px] font-bold text-muted-foreground sm:inline">Cliquez sur la carte pour placer un point</span>
      </div>
    </div>
  );
}