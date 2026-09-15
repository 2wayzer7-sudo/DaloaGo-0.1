import { useCallback, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import {
  Activity as ActivityIcon,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CarFront,
  Check,
  ChevronRight,
  Clock3,
  Download,
  Gauge,
  Headphones,
  LocateFixed,
  MapPin,
  Menu,
  Navigation,
  Phone,
  Radio,
  RefreshCw,
  Route as RouteIcon,
  ShieldCheck,
  Sparkles,
  Star,
  UserRound,
  UsersRound,
  WalletCards,
  X,
  XCircle,
} from 'lucide-react';
import type { Activity, DispatchOffer, Driver, Trip } from '@workspace/api-client-react';
import {
  getGetDashboardActivityQueryKey,
  getGetDashboardSummaryQueryKey,
  getGetDemandForecastQueryKey,
  getGetDemandForecastSettingsQueryKey,
  getGetDriverRepositionRecommendationQueryKey,
  getGetDispatchSettingsQueryKey,
  getGetRepositionSettingsQueryKey,
  getGetTripQueryKey,
  getGetVirtualZoneStatsQueryKey,
  getListDispatchOffersQueryKey,
  getListDriversQueryKey,
  getListTripsQueryKey,
  getListVirtualZonesQueryKey,
  useCreateTrip,
  useGetDashboardActivity,
  useGetDemandForecast,
  useGetDemandForecastSettings,
  useGetDriverRepositionRecommendation,
  useGetDispatchSettings,
  useGetDashboardSummary,
  useGetRepositionSettings,
  useGetTrip,
  useGetVirtualZoneStats,
  useHealthCheck,
  useListVirtualZones,
  useListDispatchOffers,
  useListDrivers,
  useListTrips,
  useRespondToDispatchOffer,
  useRespondToDriverRepositionRecommendation,
  useRespondToFareIncrease,
  useUpdateDispatchSettings,
  useUpdateDemandForecastSettings,
  useUpdateDriverLocation,
  useUpdateDriverStatus,
  useUpdateTripStatus,
  useCreateVirtualZone,
  useUpdateVirtualZone,
  useUpdateRepositionSettings,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { RealMap, type MapPoint, type MapSelectionMode } from '@/components/real-map';
import NotFound from '@/pages/not-found';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

const queryClient = new QueryClient();

type Status = Trip['status'];

const DALOA_GEOCODING_ENDPOINT = 'https://photon.komoot.io/api/';

type GeocodingResponse = {
  features?: Array<{
    geometry?: { coordinates?: [number, number] };
    properties?: { countrycode?: string };
  }>;
};

async function geocodeDaloaAddress(value: string, signal?: AbortSignal): Promise<MapPoint | undefined> {
  const query = `${value}, Daloa, Côte d’Ivoire`;
  const response = await fetch(`${DALOA_GEOCODING_ENDPOINT}?limit=5&lang=fr&q=${encodeURIComponent(query)}`, { signal });
  if (!response.ok) throw new Error(`Geocoding request failed with ${response.status}`);
  const data = await response.json() as GeocodingResponse;
  const feature = data.features?.find((item) => {
    const coordinates = item.geometry?.coordinates;
    return item.properties?.countrycode?.toUpperCase() === 'CI'
      && coordinates
      && coordinates.length === 2
      && coordinates.every(Number.isFinite);
  });
  const coordinates = feature?.geometry?.coordinates;
  return coordinates ? { lat: coordinates[1], lng: coordinates[0] } : undefined;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}
const statusLabels: Record<Status, string> = {
  requested: 'Recherche d’un chauffeur',
  accepted: 'Chauffeur assigné',
  arriving: 'Chauffeur en approche',
  in_progress: 'Course en cours',
  completed: 'Terminée',
  cancelled: 'Annulée',
};

const statusTone: Record<Status, string> = {
  requested: 'bg-[hsl(44_78%_54%/.18)] text-[hsl(160_56%_22%)]',
  accepted: 'bg-[hsl(205_64%_58%/.16)] text-[hsl(205_56%_31%)]',
  arriving: 'bg-[hsl(14_73%_56%/.16)] text-[hsl(14_62%_40%)]',
  in_progress: 'bg-[hsl(160_56%_27%/.14)] text-[hsl(160_56%_22%)]',
  completed: 'bg-[hsl(160_56%_27%/.14)] text-[hsl(160_56%_22%)]',
  cancelled: 'bg-[hsl(4_65%_47%/.14)] text-[hsl(4_65%_40%)]',
};

function formatMoney(amount: number | undefined) {
  return `${new Intl.NumberFormat('fr-FR').format(Math.round(amount ?? 0))} FCFA`;
}

function timeAgo(date: string | undefined) {
  if (!date) return 'À l’instant';
  const mins = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60000));
  if (mins < 1) return 'À l’instant';
  if (mins < 60) return `Il y a ${mins} min`;
  return `Il y a ${Math.floor(mins / 60)} h`;
}

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-3" data-testid="link-logo">
      <img src={`${import.meta.env.BASE_URL}daloago-logo-simple.jpg`} alt="DaloaGo" className="h-10 w-10 rounded-[14px] object-cover shadow-[0_4px_0_hsl(160_56%_20%)]" />
      <span className="text-[21px] font-bold tracking-[-.05em]">Daloa<span className="text-accent">Go</span></span>
    </Link>
  );
}

function Topbar({ title, eyebrow, onMenu }: { title: string; eyebrow: string; onMenu?: () => void }) {
  const [location] = useLocation();
  const health = useHealthCheck({ query: { staleTime: 60000, queryKey: ['/api/healthz'] } });
  return (
    <header className="flex min-h-[76px] items-center justify-between border-b border-border/70 bg-[hsl(var(--background)/.78)] px-5 py-4 backdrop-blur-md md:px-9">
      <div className="flex items-center gap-3">
        {onMenu && <button onClick={onMenu} className="rounded-xl p-2 hover:bg-muted md:hidden" aria-label="Ouvrir le menu" data-testid="button-open-menu"><Menu className="h-5 w-5" /></button>}
        <div>
          <p className="mono text-[10px] font-bold uppercase tracking-[.18em] text-muted-foreground">{eyebrow}</p>
          <h1 className="text-[21px] font-bold tracking-[-.04em]">{title}</h1>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground sm:flex">
          <span className={`h-2 w-2 rounded-full ${health.isError ? 'bg-destructive' : 'pulse-dot bg-[hsl(160_56%_40%)]'}`} />
          {health.isError ? 'Problème de connexion' : 'Daloa en direct'}
        </span>
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-sm font-bold text-secondary-foreground">KM</div>
        <div className="hidden leading-tight lg:block">
          <p className="text-sm font-bold">Kouassi Mireille</p>
          <p className="text-[11px] text-muted-foreground">{location === '/operations' ? 'Responsable opérations' : location === '/driver' ? 'Espace chauffeur' : 'Compte passager'}</p>
        </div>
      </div>
    </header>
  );
}

function SideNav({ open, close }: { open: boolean; close: () => void }) {
  return (
    <>
      {open && <button aria-label="Fermer la navigation" onClick={close} className="fixed inset-0 z-30 bg-[hsl(160_28%_12%/.34)] md:hidden" data-testid="button-close-overlay" />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col bg-primary px-5 py-6 text-primary-foreground transition-transform duration-300 md:static md:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="mb-10 flex items-center justify-between">
          <Logo />
          <button onClick={close} className="rounded-lg p-1 text-primary-foreground/70 hover:bg-primary-foreground/10 md:hidden" aria-label="Fermer la navigation" data-testid="button-close-menu"><X className="h-5 w-5" /></button>
        </div>
        <p className="mono mb-3 px-3 text-[9px] font-bold uppercase tracking-[.18em] text-primary-foreground/45">Espace de travail</p>
        <nav className="space-y-1">
          <NavLink href="/" icon={MapPin} label="Réserver une course" close={close} />
          <NavLink href="/driver" icon={CarFront} label="Espace chauffeur" close={close} />
          <NavLink href="/operations" icon={BarChart3} label="Opérations" close={close} />
        </nav>
        <div className="mt-auto">
          <div className="mb-5 rounded-2xl border border-primary-foreground/10 bg-primary-foreground/[.07] p-4">
            <div className="mb-3 flex items-center gap-2 text-secondary"><Radio className="h-4 w-4" /><span className="mono text-[10px] font-bold uppercase tracking-wider">Pouls de la ville</span></div>
            <p className="text-sm font-semibold leading-snug text-primary-foreground/90">Daloa est en mouvement.</p>
            <p className="mt-1 text-xs leading-relaxed text-primary-foreground/55">Le dispatch est actif dans toute la ville.</p>
          </div>
          <p className="px-3 text-[11px] text-primary-foreground/40">DaloaGo · v0.1 MVP</p>
        </div>
      </aside>
    </>
  );
}

function NavLink({ href, icon: Icon, label, close }: { href: string; icon: typeof MapPin; label: string; close: () => void }) {
  const [location] = useLocation();
  const active = href === '/' ? location === '/' : location.startsWith(href);
  return <Link href={href} onClick={close} className={`group flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition-all ${active ? 'bg-secondary text-secondary-foreground shadow-[0_3px_0_hsl(43_75%_42%)]' : 'text-primary-foreground/65 hover:bg-primary-foreground/10 hover:text-primary-foreground'}`} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}><Icon className="h-[18px] w-[18px]" /><span>{label}</span>{active && <ChevronRight className="ml-auto h-4 w-4" />}</Link>;
}

function AppShell({ children, title, eyebrow }: { children: React.ReactNode; title: string; eyebrow: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return <div className="app-shell flex min-h-[100dvh]"><SideNav open={menuOpen} close={() => setMenuOpen(false)} /><div className="min-w-0 flex-1"><Topbar title={title} eyebrow={eyebrow} onMenu={() => setMenuOpen(true)} /><main className="mx-auto w-full max-w-[1500px] p-5 md:p-9">{children}</main></div></div>;
}

function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    if (standalone) return;

    const isIosDevice = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    setIos(isIosDevice);
    if (isIosDevice) setShow(true);

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
      setShow(true);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    const revealTimer = window.setTimeout(() => setShow(true), 1200);
    return () => {
      window.clearTimeout(revealTimer);
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    };
  }, []);

  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    setInstallEvent(null);
    if (choice.outcome === 'accepted') setShow(false);
  };

  if (!show) return null;

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/20 p-4 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" aria-labelledby="install-title">
    <div className="w-full max-w-sm rounded-[24px] border border-border bg-card p-5 shadow-2xl">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-secondary/25 text-primary"><Download className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1"><h2 id="install-title" className="text-lg font-bold">Installer DaloaGo</h2><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{ios ? 'Ajoutez DaloaGo à votre écran d’accueil depuis le menu Partager.' : 'Installez DaloaGo pour retrouver une expérience rapide, comme une vraie application mobile.'}</p></div>
        <button type="button" onClick={() => setShow(false)} className="rounded-lg p-1 text-muted-foreground hover:bg-muted" aria-label="Fermer"><X className="h-4 w-4" /></button>
      </div>
      {ios ? <p className="mt-4 rounded-xl bg-muted p-3 text-xs font-semibold text-foreground">1. Touchez <span className="text-primary">Partager</span> dans votre navigateur.<br />2. Choisissez <span className="text-primary">Sur l’écran d’accueil</span>.</p> : installEvent ? <button type="button" onClick={install} className="mt-5 w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground shadow-[0_3px_0_hsl(160_56%_20%)]">Installer l’application</button> : <p className="mt-4 rounded-xl bg-muted p-3 text-xs font-semibold text-foreground">Ouvrez le menu de votre navigateur, puis choisissez <span className="text-primary">Installer l’application</span> ou <span className="text-primary">Ajouter à l’écran d’accueil</span>.</p>}
    </div>
  </div>;
}

function StatusBadge({ status }: { status: Status }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${statusTone[status]}`} data-testid={`status-trip-${status}`}><span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current" />{statusLabels[status]}</span>;
}

function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-xl ${className}`} aria-label="Chargement" data-testid="loading-skeleton" />;
}

function ErrorState({ retry, label = 'Impossible de charger cette vue' }: { retry: () => void; label?: string }) {
  return <div className="rounded-2xl border border-[hsl(4_65%_47%/.22)] bg-[hsl(4_65%_47%/.06)] p-8 text-center" data-testid="state-error"><XCircle className="mx-auto mb-3 h-8 w-8 text-destructive" /><h3 className="font-bold">{label}</h3><p className="mt-1 text-sm text-muted-foreground">Vérifie la connexion puis réessaie.</p><button onClick={retry} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground" data-testid="button-retry"><RefreshCw className="h-4 w-4" />Réessayer</button></div>;
}

function EmptyState({ title, copy }: { title: string; copy: string }) {
  return <div className="rounded-2xl border border-dashed border-border bg-card/70 p-10 text-center" data-testid="state-empty"><div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-primary"><RouteIcon className="h-5 w-5" /></div><h3 className="font-bold">{title}</h3><p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{copy}</p></div>;
}

function BookingCard({ onBooked, pickup, destination, pickupPoint, destinationPoint, onPickupChange, onDestinationChange, onLocationsReady }: { onBooked: (trip: Trip) => void; pickup: string; destination: string; pickupPoint?: MapPoint; destinationPoint?: MapPoint; onPickupChange: (value: string) => void; onDestinationChange: (value: string) => void; onLocationsReady: () => Promise<{ pickup: MapPoint; destination: MapPoint } | undefined> }) {
  const createTrip = useCreateTrip();
  const [name, setName] = useState('Kouassi Mireille');
  const [phone, setPhone] = useState('+225 07 08 14 22 90');
  const [error, setError] = useState('');
  const [resolvingLocations, setResolvingLocations] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pickup.trim().length < 2 || destination.trim().length < 2) { setError('Ajoute un point de départ et une destination pour continuer.'); return; }
    setError('');
    setResolvingLocations(true);
    const locations = await onLocationsReady();
    setResolvingLocations(false);
    if (!locations) { setError('Impossible de localiser le départ ou la destination. Précise les noms puis réessaie.'); return; }
    createTrip.mutate({ data: { passengerName: name, passengerPhone: phone, pickup, destination, distanceKm: 4.8, durationMin: 18, pickupLatitude: locations.pickup.lat, pickupLongitude: locations.pickup.lng, destinationLatitude: locations.destination.lat, destinationLongitude: locations.destination.lng } }, { onSuccess: onBooked, onError: () => setError('La course n’a pas pu être demandée. Réessaie.') });
  };
  return <form onSubmit={submit} className="card-lift relative overflow-hidden rounded-[24px] border border-border bg-card p-5 md:p-7" data-testid="form-book-ride">
    <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-secondary/20" />
    <div className="relative">
       <div className="mb-7 flex items-start justify-between"><div><p className="mono text-[10px] font-bold uppercase tracking-[.18em] text-accent">Passager</p><h2 className="mt-1 text-2xl font-bold tracking-[-.05em]">Où allez-vous ?</h2><p className="mt-1 text-sm text-muted-foreground">Un chauffeur proche peut vous rejoindre en quelques minutes.</p></div><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary/20 text-primary"><LocateFixed className="h-5 w-5" /></span></div>
      <div className="space-y-3">
         <Field label="Votre nom" icon={UserRound} value={name} onChange={setName} testId="input-passenger-name" />
         <Field label="Numéro de téléphone" icon={Phone} value={phone} onChange={setPhone} testId="input-passenger-phone" type="tel" />
        <div className="relative ml-1 border-l border-dashed border-primary/30 pl-5">
            <Field label="Point de départ" icon={MapPin} value={pickup} onChange={onPickupChange} testId="input-pickup" placeholder="ex. Gare routière de Daloa" accent />
            <Field label="Destination" icon={Navigation} value={destination} onChange={onDestinationChange} testId="input-destination" placeholder="ex. Quartier Tazibouo" accent={false} />
        </div>
      </div>
      {error && <p className="mt-3 text-xs font-semibold text-destructive" data-testid="text-booking-error">{error}</p>}
       <div className="mt-6 flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground"><ShieldCheck className="mr-1 inline h-4 w-4 text-primary" />Sûr, local et fiable</span><button disabled={createTrip.isPending || resolvingLocations} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-[0_4px_0_hsl(160_56%_20%)] transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-60" data-testid="button-request-ride">{resolvingLocations ? <><RefreshCw className="h-4 w-4 animate-spin" />Localisation des points</> : createTrip.isPending ? <><RefreshCw className="h-4 w-4 animate-spin" />Recherche d’un chauffeur</> : <>Demander une course <ArrowUpRight className="h-4 w-4" /></>}</button></div>
    </div>
  </form>;
}

function Field({ label, icon: Icon, value, onChange, testId, placeholder, type = 'text', accent = false }: { label: string; icon: typeof MapPin; value: string; onChange: (value: string) => void; testId: string; placeholder?: string; type?: string; accent?: boolean }) {
  return <label className="block"><span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span><div className={`flex items-center gap-3 rounded-xl border bg-background px-3.5 py-3 transition-colors focus-within:border-primary ${accent ? 'border-border' : 'border-border/80'}`}><Icon className={`h-4 w-4 shrink-0 ${accent ? 'text-accent' : 'text-primary'}`} /><input required value={value} onChange={(e) => onChange(e.target.value)} type={type} placeholder={placeholder} className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/65" data-testid={testId} /></div></label>;
}

function MapPanel({ pickup, destination, userLocation, mode, locationStatus, onSelect, onModeChange, onLocate }: { pickup?: MapPoint; destination?: MapPoint; userLocation?: MapPoint; mode: MapSelectionMode; locationStatus: string; onSelect: (point: MapPoint) => void; onModeChange: (mode: MapSelectionMode) => void; onLocate: () => void }) {
  return <RealMap pickup={pickup} destination={destination} userLocation={userLocation} mode={mode} locationStatus={locationStatus} onSelect={onSelect} onModeChange={onModeChange} onLocate={onLocate} />;
}

function TripTracking({ trip, onCancel, cancelPending, onFareResponse, fareResponsePending }: { trip: Trip; onCancel: () => void; cancelPending: boolean; onFareResponse: (decision: 'accept' | 'reject') => void; fareResponsePending: boolean }) {
  const status = trip.status;
  const steps: Status[] = ['requested', 'accepted', 'arriving', 'in_progress'];
  const currentIndex = Math.max(0, steps.indexOf(status));
  return <div className="card-lift rounded-[24px] border border-border bg-card p-5 md:p-7" data-testid="card-current-trip">
     <div className="flex items-start justify-between gap-4"><div><p className="mono text-[10px] font-bold uppercase tracking-[.18em] text-accent">Course n°{trip.id}</p><h2 className="mt-1 text-2xl font-bold tracking-[-.05em]">{statusLabels[status]}</h2><p className="mt-1 text-sm text-muted-foreground">{trip.pickup} <span className="mx-1 text-accent">→</span> {trip.destination}</p></div><StatusBadge status={status} /></div>
     {status !== 'completed' && status !== 'cancelled' && <div className="my-8 flex items-start">{steps.map((step, index) => <div key={step} className="flex flex-1 items-start"><div className="relative flex flex-col items-center"><span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${index <= currentIndex ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{index < currentIndex ? <Check className="h-4 w-4" /> : index + 1}</span><span className="mt-2 w-20 text-center text-[10px] font-semibold leading-tight text-muted-foreground">{step === 'in_progress' ? 'En route' : step === 'requested' ? 'Demandée' : step === 'accepted' ? 'Assignée' : 'En approche'}</span></div>{index < steps.length - 1 && <div className={`mt-3 h-0.5 flex-1 ${index < currentIndex ? 'bg-primary' : 'bg-border'}`} />}</div>)}</div>}
     {trip.driverName ? <div className="flex items-center gap-3 rounded-2xl bg-muted/70 p-3"><div className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-sm font-bold text-secondary-foreground">{trip.driverName.slice(0, 2).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="text-sm font-bold">{trip.driverName}</p><p className="text-xs text-muted-foreground">{trip.vehicle || 'Véhicule'} · Votre chauffeur est à proximité</p></div><button className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground" aria-label="Appeler le chauffeur" data-testid="button-call-driver"><Phone className="h-4 w-4" /></button></div> : <div className="flex items-center gap-3 rounded-2xl bg-secondary/15 p-4"><div className="pulse-dot flex h-9 w-9 items-center justify-center rounded-full bg-secondary"><Radio className="h-4 w-4 text-secondary-foreground" /></div><p className="text-sm font-semibold">Nous recherchons un chauffeur à proximité.</p></div>}
      {trip.fareProposalStatus === 'pending' && trip.fareProposalAmount ? <div className="my-5 rounded-2xl border border-secondary/60 bg-secondary/15 p-4" data-testid="card-fare-proposal"><div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground"><WalletCards className="h-4 w-4" /></span><div className="min-w-0"><p className="text-sm font-bold">Le tarif doit être ajusté</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Aucun chauffeur n’est encore disponible dans le rayon actuel. Acceptez une hausse de {formatMoney(trip.fareProposalAmount)} pour continuer la recherche.</p><div className="mt-3 flex gap-2"><button onClick={() => onFareResponse('accept')} disabled={fareResponsePending} className="rounded-xl bg-primary px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50" data-testid="button-accept-fare-increase">{fareResponsePending ? 'Envoi…' : 'Accepter la hausse'}</button><button onClick={() => onFareResponse('reject')} disabled={fareResponsePending} className="rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-foreground disabled:opacity-50" data-testid="button-reject-fare-increase">Garder le tarif</button></div></div></div></div> : null}
       <div className="mt-5 flex items-center justify-between border-t border-border pt-4"><div><p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Tarif estimé</p><p className="mono mt-1 text-xl font-bold">{formatMoney(trip.fare || 1500)}</p>{trip.initialFare !== trip.fare && <p className="mt-1 text-[10px] text-muted-foreground">Tarif initial : {formatMoney(trip.initialFare)}</p>}</div>{status !== 'completed' && status !== 'cancelled' && <button onClick={onCancel} disabled={cancelPending} className="text-xs font-bold text-destructive hover:underline disabled:opacity-50" data-testid="button-cancel-trip">{cancelPending ? 'Annulation…' : 'Annuler la course'}</button>}</div>
  </div>;
}

function PassengerHome() {
  const queryClient = useQueryClient();
  const tripsQuery = useListTrips({ role: 'passenger' }, { query: { staleTime: 15000, queryKey: getListTripsQueryKey({ role: 'passenger' }) } });
  const updateTrip = useUpdateTripStatus();
  const [currentTripId, setCurrentTripId] = useState<number>();
  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [pickupPoint, setPickupPoint] = useState<MapPoint>();
  const [destinationPoint, setDestinationPoint] = useState<MapPoint>();
  const [userLocation, setUserLocation] = useState<MapPoint>();
  const [selectionMode, setSelectionMode] = useState<MapSelectionMode>('pickup');
  const [locationStatus, setLocationStatus] = useState('Demande de position…');
  const currentTripQuery = useGetTrip(currentTripId ?? 0, { query: { enabled: Boolean(currentTripId), queryKey: getGetTripQueryKey(currentTripId ?? 0), staleTime: 10000, refetchInterval: 12000 } });
  const respondToFareIncrease = useRespondToFareIncrease();
  const trips = tripsQuery.data ?? [];
  const currentTrip = currentTripQuery.data ?? trips.find((item) => item.id === currentTripId);
  const recentTrips = trips.filter((item) => item.id !== currentTripId).slice(0, 3);
  const resetBooking = useCallback(() => {
    setCurrentTripId(undefined);
    setPickup('');
    setDestination('');
    setPickupPoint(undefined);
    setDestinationPoint(undefined);
    setSelectionMode('pickup');
    setLocationStatus('Demande de position…');
  }, []);
  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) { setLocationStatus('Géolocalisation indisponible'); return; }
    setLocationStatus('Recherche de votre position…');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { setUserLocation({ lat: coords.latitude, lng: coords.longitude }); setLocationStatus('Votre position actuelle'); },
      (geoError) => { setLocationStatus(geoError.code === 1 ? 'Autorisation de localisation refusée' : 'Position indisponible'); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  }, []);
  useEffect(() => { requestLocation(); }, [requestLocation]);
  useEffect(() => {
    const pickupQuery = pickup.trim();
    const destinationQuery = destination.trim();
    const pickupNeedsGeocoding = pickupQuery.length >= 3 && !pickupQuery.startsWith('Position (');
    const destinationNeedsGeocoding = destinationQuery.length >= 3 && !destinationQuery.startsWith('Position (');
    if (!pickupNeedsGeocoding && !destinationNeedsGeocoding) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLocationStatus('Recherche de vos adresses…');
      try {
        const [resolvedPickup, resolvedDestination] = await Promise.all([
          pickupNeedsGeocoding ? geocodeDaloaAddress(pickupQuery, controller.signal) : Promise.resolve(pickupPoint),
          destinationNeedsGeocoding ? geocodeDaloaAddress(destinationQuery, controller.signal) : Promise.resolve(destinationPoint),
        ]);
        if (controller.signal.aborted) return;
        if (pickupNeedsGeocoding) setPickupPoint(resolvedPickup);
        if (destinationNeedsGeocoding) setDestinationPoint(resolvedDestination);
        if ((pickupNeedsGeocoding && !resolvedPickup) || (destinationNeedsGeocoding && !resolvedDestination)) {
          setLocationStatus('Un point n’a pas été trouvé dans Daloa');
        } else if (resolvedPickup && resolvedDestination) {
          setLocationStatus('Départ et destination localisés');
        } else {
          setLocationStatus('Adresse localisée, complète le second point');
        }
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setLocationStatus('Recherche d’adresse indisponible');
      }
    }, 650);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [pickup, destination]);
  const handlePickupChange = useCallback((value: string) => {
    setPickup(value);
    setPickupPoint(undefined);
    setLocationStatus(value.trim().length >= 3 ? 'Recherche du départ…' : 'Saisis un point de départ');
  }, []);
  const handleDestinationChange = useCallback((value: string) => {
    setDestination(value);
    setDestinationPoint(undefined);
    setLocationStatus(value.trim().length >= 3 ? 'Recherche de la destination…' : 'Saisis une destination');
  }, []);
  const selectMapPoint = useCallback((point: MapPoint) => {
    const label = `Position (${point.lat.toFixed(5)}, ${point.lng.toFixed(5)})`;
    if (selectionMode === 'pickup') { setPickupPoint(point); setPickup(label); setSelectionMode('destination'); }
    else { setDestinationPoint(point); setDestination(label); }
  }, [selectionMode]);
  const resolveLocationsForBooking = useCallback(async (): Promise<{ pickup: MapPoint; destination: MapPoint } | undefined> => {
    const controller = new AbortController();
    try {
      const [resolvedPickup, resolvedDestination] = await Promise.all([
        pickupPoint ?? geocodeDaloaAddress(pickup.trim(), controller.signal),
        destinationPoint ?? geocodeDaloaAddress(destination.trim(), controller.signal),
      ]);
      if (resolvedPickup) setPickupPoint(resolvedPickup);
      if (resolvedDestination) setDestinationPoint(resolvedDestination);
      if (!resolvedPickup || !resolvedDestination) {
        setLocationStatus('Un point n’a pas été trouvé dans Daloa');
        return undefined;
      }
      setLocationStatus('Départ et destination localisés');
      return { pickup: resolvedPickup, destination: resolvedDestination };
    } catch {
      setLocationStatus('Recherche d’adresse indisponible');
      return undefined;
    }
  }, [pickup, destination, pickupPoint, destinationPoint]);
  const handleBooked = (trip: Trip) => { setCurrentTripId(trip.id); queryClient.setQueryData(getGetTripQueryKey(trip.id), trip); queryClient.invalidateQueries({ queryKey: getListTripsQueryKey({ role: 'passenger' }) }); };
  useEffect(() => {
    if (currentTripId && currentTrip?.status === 'cancelled') resetBooking();
  }, [currentTrip, currentTripId, resetBooking]);
  const cancel = () => {
    if (!currentTripId) return;
    updateTrip.mutate({ id: currentTripId, data: { status: 'cancelled', reason: 'annulee_par_passager' } }, {
      onSuccess: (trip) => {
        queryClient.setQueryData(getGetTripQueryKey(trip.id), trip);
        queryClient.invalidateQueries({ queryKey: getListTripsQueryKey({ role: 'passenger' }) });
        if (trip.status === 'cancelled') resetBooking();
      },
    });
  };
  const respondToFare = (decision: 'accept' | 'reject') => { if (!currentTripId) return; respondToFareIncrease.mutate({ id: currentTripId, data: { decision } }, { onSuccess: (result) => { queryClient.setQueryData(getGetTripQueryKey(currentTripId), result.trip); queryClient.invalidateQueries({ queryKey: getListTripsQueryKey({ role: 'passenger' }) }); } }); };
  return <AppShell title="Bonjour, Mireille" eyebrow="Passager / Réserver une course"><div className="grid gap-6 xl:grid-cols-[minmax(420px,0.8fr)_1.2fr]"><div className="space-y-6"><div className="animate-rise rounded-[24px] bg-primary p-6 text-primary-foreground shadow-[0_8px_0_hsl(160_56%_20%)] md:p-8"><div className="flex items-center justify-between"><div><p className="mono text-[10px] font-bold uppercase tracking-[.2em] text-primary-foreground/55">Votre ville. Votre trajet.</p><h2 className="mt-3 max-w-sm text-[34px] font-bold leading-[.98] tracking-[-.07em]">Déplacez-vous à Daloa en toute confiance.</h2></div><Sparkles className="h-7 w-7 text-secondary" /></div><p className="mt-5 max-w-sm text-sm leading-relaxed text-primary-foreground/70">Demandez une course locale, suivez son arrivée et rejoignez votre destination sereinement.</p></div>{currentTrip ? <TripTracking trip={currentTrip} onCancel={cancel} cancelPending={updateTrip.isPending} onFareResponse={respondToFare} fareResponsePending={respondToFareIncrease.isPending} /> : <BookingCard onBooked={handleBooked} pickup={pickup} destination={destination} pickupPoint={pickupPoint} destinationPoint={destinationPoint} onPickupChange={handlePickupChange} onDestinationChange={handleDestinationChange} onLocationsReady={resolveLocationsForBooking} />}</div><div className="animate-rise-2 space-y-6"><MapPanel pickup={pickupPoint} destination={destinationPoint} userLocation={userLocation} mode={selectionMode} locationStatus={locationStatus} onSelect={selectMapPoint} onModeChange={setSelectionMode} onLocate={requestLocation} /><div className="rounded-[24px] border border-border bg-card p-5" data-testid="section-recent-trips"><div className="mb-4 flex items-center justify-between"><div><p className="mono text-[10px] font-bold uppercase tracking-[.18em] text-muted-foreground">Votre activité</p><h3 className="mt-1 text-lg font-bold">Courses récentes</h3></div><span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-bold text-muted-foreground">{trips.length} au total</span></div>{tripsQuery.isLoading ? <div className="space-y-3"><SkeletonBlock className="h-14" /><SkeletonBlock className="h-14" /></div> : tripsQuery.isError ? <ErrorState retry={() => tripsQuery.refetch()} label="Vos courses prennent un détour" /> : recentTrips.length === 0 ? <EmptyState title="Votre historique est vide" copy="Vos courses terminées apparaîtront ici." /> : <div className="space-y-1">{recentTrips.map((trip) => <button key={trip.id} onClick={() => setCurrentTripId(trip.id)} className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors hover:bg-muted" data-testid={`button-trip-history-${trip.id}`}><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary/20 text-primary"><RouteIcon className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{trip.pickup} <span className="font-normal text-muted-foreground">vers</span> {trip.destination}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{timeAgo(trip.requestedAt)} · {formatMoney(trip.fare)}</p></div><StatusBadge status={trip.status} /></button>)}</div>}</div></div></div></AppShell>;
}

function DriverHome() {
  const MIN_ACTIVE_DRIVERS_FOR_FILTERED_QUEUE = 25;
  const queryClient = useQueryClient();
  const tripQuery = useListTrips({ role: 'driver' }, { query: { staleTime: 10000, queryKey: getListTripsQueryKey({ role: 'driver' }) } });
  const driverQuery = useListDrivers({ query: { staleTime: 30000, queryKey: getListDriversQueryKey() } });
  const me = (driverQuery.data ?? []).find((driver) => driver.status === 'available') ?? driverQuery.data?.[0];
  const offerQuery = useListDispatchOffers({ driverId: me?.id ?? 0 }, { query: { enabled: Boolean(me?.id), staleTime: 3000, queryKey: getListDispatchOffersQueryKey({ driverId: me?.id ?? 0 }) } });
  const updateTrip = useUpdateTripStatus();
  const respondOfferMutation = useRespondToDispatchOffer();
  const updateLocation = useUpdateDriverLocation();
  const updateDriverStatus = useUpdateDriverStatus();
  const [activeId, setActiveId] = useState<number>();
  const trips = tripQuery.data ?? [];
  const offers = offerQuery.data ?? [];
  const assignedTrips = trips.filter((trip) => trip.driverId === me?.id && ['accepted', 'arriving', 'in_progress'].includes(trip.status));
  const totalActive = (driverQuery.data ?? []).filter((driver) => driver.status === 'available' || driver.status === 'on_trip').length;
  const showGlobalTripQueue = totalActive < MIN_ACTIVE_DRIVERS_FOR_FILTERED_QUEUE;
  const queue = showGlobalTripQueue
    ? trips
    : [...offers.map((offer) => offer.trip), ...assignedTrips.filter((trip) => !offers.some((offer) => offer.tripId === trip.id))];
  const active = queue.find((trip) => trip.id === activeId) ?? queue[0];
  const activeOffer = offers.find((offer) => offer.tripId === active?.id);
  const changeStatus = (status: 'accepted' | 'arriving' | 'in_progress' | 'completed' | 'cancelled') => { if (!active) return; updateTrip.mutate({ id: active.id, data: { status } }, { onSuccess: (trip) => { setActiveId(trip.id); queryClient.setQueryData(getListTripsQueryKey({ role: 'driver' }), (old: Trip[] | undefined) => old?.map((item) => item.id === trip.id ? trip : item)); queryClient.invalidateQueries({ queryKey: getListDriversQueryKey() }); queryClient.invalidateQueries({ queryKey: getListTripsQueryKey({ role: 'admin' }) }); } }); };
  const respondToOffer = (offer: DispatchOffer, decision: 'accept' | 'reject') => {
    if (!me) return;
    respondOfferMutation.mutate({ id: offer.id, data: { driverId: me.id, decision } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListDispatchOffersQueryKey({ driverId: me.id }) });
        queryClient.invalidateQueries({ queryKey: getListTripsQueryKey({ role: 'driver' }) });
        queryClient.invalidateQueries({ queryKey: getListDriversQueryKey() });
      },
    });
  };
  useEffect(() => {
    if (!me?.id || !navigator.geolocation) return;
    const sendLocation = () => navigator.geolocation.getCurrentPosition(({ coords }) => {
      updateLocation.mutate({ id: me.id, data: { latitude: coords.latitude, longitude: coords.longitude } }, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListDriversQueryKey() }),
      });
    }, () => undefined, { enableHighAccuracy: true, maximumAge: 30000, timeout: 10000 });
    sendLocation();
    const timer = window.setInterval(sendLocation, 30000);
    return () => window.clearInterval(timer);
  }, [me?.id]);
  return <AppShell title="Espace chauffeur" eyebrow="Chauffeur / File de dispatch"><div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="mono text-[11px] font-bold uppercase tracking-[.18em] text-accent">Service en cours</p><h2 className="mt-1 text-3xl font-bold tracking-[-.06em]">Faites avancer Daloa.</h2><p className="mt-2 text-sm text-muted-foreground">Les demandes arrivent une par une selon votre position GPS.</p></div><div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3"><span className={`pulse-dot h-2.5 w-2.5 ${me?.status === 'available' ? 'bg-primary' : 'bg-muted-foreground'}`} /><span className="text-sm font-bold">{me?.name || 'Mode chauffeur'} </span><span className="text-xs text-muted-foreground">· {me?.tripsToday ?? 0} courses aujourd’hui</span>{me && <select value={me.status} onChange={(event) => updateDriverStatus.mutate({ id: me.id, data: { status: event.target.value as 'available' | 'on_trip' | 'offline' } }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListDriversQueryKey() }) })} className="rounded-lg border border-border bg-background px-2 py-1 text-xs font-bold" aria-label="Disponibilité du chauffeur" data-testid="select-driver-status"><option value="available">Disponible</option><option value="on_trip">En course</option><option value="offline">Hors ligne</option></select>}</div></div><div className="grid gap-6 xl:grid-cols-[1.1fr_.9fr]"><div className="space-y-6"><div className="grid grid-cols-2 gap-3 md:grid-cols-3"><MiniStat icon={Clock3} label="Offres" value={offers.length.toString()} /><MiniStat icon={Gauge} label="Aujourd’hui" value={(me?.tripsToday ?? 0).toString()} /><MiniStat icon={Star} label="Note" value={me?.rating?.toFixed(1) ?? '—'} /></div>{tripQuery.isLoading || offerQuery.isLoading ? <div className="space-y-3"><SkeletonBlock className="h-28" /><SkeletonBlock className="h-28" /></div> : tripQuery.isError || offerQuery.isError ? <ErrorState retry={() => { void tripQuery.refetch(); void offerQuery.refetch(); }} /> : queue.length === 0 ? <EmptyState title="La file est vide" copy="Les nouvelles offres apparaîtront ici." /> : <div className="space-y-3" data-testid="list-driver-queue">{queue.map((trip) => <button key={trip.id} onClick={() => setActiveId(trip.id)} className={`w-full rounded-2xl border p-4 text-left transition-all ${active?.id === trip.id ? 'border-primary bg-primary/[.04] shadow-[0_0_0_2px_hsl(160_56%_27%/.1)]' : 'border-border bg-card hover:border-primary/40'}`} data-testid={`button-driver-trip-${trip.id}`}><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold">{trip.pickup} <span className="px-1 text-accent">→</span> {trip.destination}</p><p className="mt-1 text-xs text-muted-foreground">{timeAgo(trip.requestedAt)} · {trip.distanceKm} km · {formatMoney(trip.fare)}</p></div><StatusBadge status={trip.status} /></div></button>)}</div>}</div><div className="space-y-6"><RealMap mode="pickup" locationStatus="Carte réelle de Daloa" onModeChange={() => undefined} onLocate={() => undefined} showSelectionControls={false} showLocateControl={false} /><div className="card-lift rounded-[24px] border border-border bg-card p-5" data-testid="card-driver-action">{active ? <><div className="flex items-start justify-between"><div><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-muted-foreground">Demande sélectionnée</p><h3 className="mt-1 text-xl font-bold">{active.passengerName}</h3></div><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary/20 text-primary"><UserRound className="h-5 w-5" /></div></div><div className="my-5 space-y-3 text-sm"><InfoRow icon={MapPin} label="Départ" value={active.pickup} /><InfoRow icon={Navigation} label="Arrivée" value={active.destination} /><InfoRow icon={WalletCards} label="Tarif" value={formatMoney(active.fare)} />{activeOffer && <InfoRow icon={Clock3} label="ETA" value={`${activeOffer.etaMin} min · ${activeOffer.distanceKm} km`} />}</div><DriverAction status={active.status} pending={updateTrip.isPending || respondOfferMutation.isPending} offer={activeOffer} onChange={changeStatus} onOfferResponse={respondToOffer} /></> : <EmptyState title="Aucune course sélectionnée" copy="Choisissez une offre pour voir les commandes de la course." />}</div></div></div></AppShell>;
}

function DriverAction({ status, pending, offer, onChange, onOfferResponse }: { status: Status; pending: boolean; offer?: DispatchOffer; onChange: (status: 'accepted' | 'arriving' | 'in_progress' | 'completed' | 'cancelled') => void; onOfferResponse: (offer: DispatchOffer, decision: 'accept' | 'reject') => void }) {
  const next: Partial<Record<Status, { label: string; status: 'accepted' | 'arriving' | 'in_progress' | 'completed' | 'cancelled' }>> = { requested: { label: 'Accepter la demande', status: 'accepted' }, accepted: { label: 'Je suis en approche', status: 'arriving' }, arriving: { label: 'Démarrer la course', status: 'in_progress' }, in_progress: { label: 'Terminer la course', status: 'completed' } };
  const action = next[status];
  if (status === 'requested') {
    return offer ? <div className="grid grid-cols-2 gap-2"><button onClick={() => onOfferResponse(offer, 'accept')} disabled={pending} className="rounded-xl bg-primary px-3 py-3 text-sm font-bold text-primary-foreground shadow-[0_3px_0_hsl(160_56%_20%)] disabled:opacity-50" data-testid="button-driver-accept-offer">{pending ? 'Envoi…' : 'Accepter l’offre'}</button><button onClick={() => onOfferResponse(offer, 'reject')} disabled={pending} className="rounded-xl border border-border px-3 py-3 text-sm font-bold text-destructive disabled:opacity-50" data-testid="button-driver-reject-offer">Refuser</button></div> : <div className="rounded-xl bg-muted p-3 text-center text-sm font-semibold text-muted-foreground">Recherche d’une offre pour votre véhicule…</div>;
  }
  if (!action) return <div className="rounded-xl bg-muted p-3 text-center text-sm font-semibold text-muted-foreground">{status === 'completed' ? 'Course terminée' : 'Course annulée'}</div>;
  return <div className="flex gap-2"><button onClick={() => onChange(action.status)} disabled={pending} className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground shadow-[0_3px_0_hsl(160_56%_20%)] disabled:opacity-50" data-testid={`button-driver-${action.status}`}>{pending ? 'Mise à jour…' : action.label}</button><button onClick={() => onChange('cancelled')} disabled={pending} className="rounded-xl border border-border px-4 py-3 text-sm font-bold text-destructive hover:bg-destructive/5 disabled:opacity-50" aria-label="Annuler la course" data-testid="button-driver-cancel"><X className="h-4 w-4" /></button></div>;
}

function MiniStat({ icon: Icon, label, value }: { icon: typeof Clock3; label: string; value: string }) {
  return <div className="rounded-2xl border border-border bg-card p-4"><Icon className="h-4 w-4 text-accent" /><p className="mono mt-4 text-2xl font-bold tracking-[-.06em]" data-testid={`text-driver-${label.toLowerCase()}`}>{value}</p><p className="mt-1 text-xs font-semibold text-muted-foreground">{label}</p>{label === 'Offres' && <DriverRepositionCard />}</div>;
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: string }) {
  return <div className="flex items-center gap-3"><Icon className="h-4 w-4 text-accent" /><span className="w-16 text-xs font-semibold text-muted-foreground">{label}</span><span className="truncate font-semibold">{value}</span></div>;
}

function Operations() {
  const summaryQuery = useGetDashboardSummary({ query: { staleTime: 15000, refetchInterval: 20000, queryKey: getGetDashboardSummaryQueryKey() } });
  const activityQuery = useGetDashboardActivity({ query: { staleTime: 15000, refetchInterval: 20000, queryKey: getGetDashboardActivityQueryKey() } });
  const tripsQuery = useListTrips({ role: 'admin' }, { query: { staleTime: 15000, queryKey: getListTripsQueryKey({ role: 'admin' }) } });
  const driversQuery = useListDrivers({ query: { staleTime: 15000, refetchInterval: 20000, queryKey: getListDriversQueryKey() } });
  const summary = summaryQuery.data;
  const trips = tripsQuery.data ?? [];
  const drivers = driversQuery.data ?? [];
  const refreshAll = () => { summaryQuery.refetch(); activityQuery.refetch(); tripsQuery.refetch(); driversQuery.refetch(); };
  const activeTrips = useMemo(() => trips.filter((trip) => ['accepted', 'arriving', 'in_progress'].includes(trip.status)), [trips]);
  return <AppShell title="Centre des opérations" eyebrow="Opérations / Vue en direct"><div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><div className="flex items-center gap-2"><span className="pulse-dot h-2.5 w-2.5 rounded-full bg-accent" /><p className="mono text-[11px] font-bold uppercase tracking-[.18em] text-accent">Pouls de la ville</p></div><h2 className="mt-2 text-3xl font-bold tracking-[-.06em]">Daloa, en ce moment.</h2><p className="mt-2 text-sm text-muted-foreground">Une vue claire de toute l’activité du réseau.</p></div><button onClick={refreshAll} className="inline-flex w-fit items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold hover:bg-muted" data-testid="button-refresh-dashboard"><RefreshCw className="h-4 w-4" />Actualiser les données</button></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{summaryQuery.isLoading ? [1,2,3,4,5].map((n) => <SkeletonBlock key={n} className="h-32" />) : summaryQuery.isError ? <div className="sm:col-span-2 xl:col-span-5"><ErrorState retry={() => summaryQuery.refetch()} label="Le résumé du tableau de bord est indisponible" /></div> : <><MetricCard label="Courses du jour" value={summary?.tripsToday ?? 0} icon={RouteIcon} detail="+12 % vs hier" up /><MetricCard label="Courses actives" value={summary?.activeTrips ?? activeTrips.length} icon={Radio} detail={`${activeTrips.length} chauffeurs en route`} /><MetricCard label="Chauffeurs disponibles" value={summary?.availableDrivers ?? drivers.filter((d) => d.status === 'available').length} icon={UsersRound} detail="Dans Daloa" /><MetricCard label="Revenus du jour" value={formatMoney(summary?.revenueToday)} icon={WalletCards} detail="Réservations brutes" currency /><MetricCard label="Taux de réussite" value={`${summary?.completionRate ?? 0}%`} icon={Gauge} detail="Dernières 24 heures" /></>}</div><div className="mt-6 grid gap-6 xl:grid-cols-[1.25fr_.75fr]"><div className="space-y-6"><div className="rounded-[24px] border border-border bg-card p-5 md:p-6" data-testid="section-trips"><div className="mb-5 flex items-center justify-between"><div><p className="mono text-[10px] font-bold uppercase tracking-[.18em] text-muted-foreground">Activité du réseau</p><h3 className="mt-1 text-xl font-bold">Courses récentes</h3></div><span className="rounded-full bg-secondary/25 px-3 py-1 text-[11px] font-bold text-primary">{trips.length} enregistrements</span></div>{tripsQuery.isLoading ? <div className="space-y-3"><SkeletonBlock className="h-16" /><SkeletonBlock className="h-16" /><SkeletonBlock className="h-16" /></div> : tripsQuery.isError ? <ErrorState retry={() => tripsQuery.refetch()} /> : trips.length === 0 ? <EmptyState title="Aucune course dans le flux" copy="Les demandes des passagers apparaîtront ici." /> : <div className="soft-scroll overflow-x-auto"><table className="w-full min-w-[640px] text-left"><thead><tr className="border-b border-border text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground"><th className="pb-3">Trajet</th><th className="pb-3">Passager</th><th className="pb-3">Chauffeur</th><th className="pb-3">Statut</th><th className="pb-3 text-right">Tarif</th></tr></thead><tbody>{trips.slice(0, 8).map((trip) => <tr key={trip.id} className="border-b border-border/60 last:border-0" data-testid={`row-trip-${trip.id}`}><td className="py-4 pr-4"><p className="max-w-[180px] truncate text-sm font-bold">{trip.pickup}</p><p className="max-w-[180px] truncate text-[11px] text-muted-foreground">vers {trip.destination}</p></td><td className="py-4 pr-4 text-sm">{trip.passengerName}</td><td className="py-4 pr-4 text-sm text-muted-foreground">{trip.driverName || 'Non attribué'}</td><td className="py-4 pr-4"><StatusBadge status={trip.status} /></td><td className="mono py-4 text-right text-xs font-bold">{formatMoney(trip.fare)}</td></tr>)}</tbody></table></div>}</div><div className="rounded-[24px] border border-border bg-primary p-5 text-primary-foreground md:p-6"><div className="flex items-center justify-between"><div><p className="mono text-[10px] font-bold uppercase tracking-[.18em] text-primary-foreground/55">État de la couverture</p><h3 className="mt-1 text-xl font-bold">Le réseau est actif.</h3></div><Radio className="h-6 w-6 text-secondary" /></div><div className="mt-6 grid grid-cols-3 gap-3 border-t border-primary-foreground/15 pt-5"><div><p className="mono text-2xl font-bold">{drivers.filter((d) => d.status === 'available').length}</p><p className="mt-1 text-[11px] text-primary-foreground/55">Disponibles</p></div><div><p className="mono text-2xl font-bold">{activeTrips.length}</p><p className="mt-1 text-[11px] text-primary-foreground/55">En route</p></div><div><p className="mono text-2xl font-bold">{drivers.filter((d) => d.status === 'offline').length}</p><p className="mt-1 text-[11px] text-primary-foreground/55">Hors ligne</p></div></div></div></div><div className="space-y-6"><div className="rounded-[24px] border border-border bg-card p-5" data-testid="section-activity"><div className="mb-5 flex items-center justify-between"><div><p className="mono text-[10px] font-bold uppercase tracking-[.18em] text-muted-foreground">Journal de dispatch</p><h3 className="mt-1 text-xl font-bold">Activité récente</h3></div><ActivityIcon className="h-5 w-5 text-accent" /></div>{activityQuery.isLoading ? <div className="space-y-4"><SkeletonBlock className="h-12" /><SkeletonBlock className="h-12" /><SkeletonBlock className="h-12" /></div> : activityQuery.isError ? <ErrorState retry={() => activityQuery.refetch()} /> : <ActivityList items={activityQuery.data ?? []} />}</div><DispatchSettingsPanel /><VirtualZonesPanel /><DriverRoster drivers={drivers} loading={driversQuery.isLoading} error={driversQuery.isError} retry={() => driversQuery.refetch()} /></div></div></AppShell>;
}

function MetricCard({ label, value, icon: Icon, detail, up, currency }: { label: string; value: number | string; icon: typeof RouteIcon; detail: string; up?: boolean; currency?: boolean }) {
  return <div className="card-lift rounded-2xl border border-border bg-card p-4" data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}><div className="flex items-center justify-between"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary/20 text-primary"><Icon className="h-4 w-4" /></span>{up !== undefined && <span className={`flex items-center text-[10px] font-bold ${up ? 'text-primary' : 'text-destructive'}`}>{up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}12%</span>}</div><p className={`mono mt-5 font-bold tracking-[-.07em] ${currency ? 'text-[19px]' : 'text-3xl'}`}>{value}</p><p className="mt-1 text-xs font-bold">{label}</p><p className="mt-1 text-[10px] text-muted-foreground">{detail}</p></div>;
}

function ActivityList({ items }: { items: Activity[] }) {
  if (!items.length) return <EmptyState title="Aucune note de dispatch" copy="L’activité en direct apparaîtra ici au fil de la journée." />;
  const localizeDescription = (description: string) => description
    .replace('Course #', 'Course n°')
    .replace(/\bin_progress\b/g, 'en cours')
    .replace(/\baccepted\b/g, 'acceptée')
    .replace(/\barriving\b/g, 'en approche')
    .replace(/\brequested\b/g, 'demandée')
    .replace(/\bcompleted\b/g, 'terminée')
    .replace(/\bcancelled\b/g, 'annulée');
  return <div className="space-y-1">{items.slice(0, 7).map((item) => <div key={item.id} className="flex gap-3 rounded-xl p-2.5 hover:bg-muted" data-testid={`activity-${item.id}`}><div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary/20 text-primary"><ActivityIcon className="h-4 w-4" /></div><div className="min-w-0"><p className="text-sm font-bold">{item.title}</p><p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{localizeDescription(item.description)}</p><p className="mono mt-1 text-[9px] text-muted-foreground">{timeAgo(item.createdAt)}</p></div></div>)}</div>;
}

function DispatchSettingsPanel() {
  const queryClient = useQueryClient();
  const settingsQuery = useGetDispatchSettings({ query: { staleTime: 30000, queryKey: getGetDispatchSettingsQueryKey() } });
  const updateSettings = useUpdateDispatchSettings();
  const [radii, setRadii] = useState('');
  const [durations, setDurations] = useState('');
  const [increaseAfter, setIncreaseAfter] = useState('');
  const [maxIncreases, setMaxIncreases] = useState('');
  const [increaseAmounts, setIncreaseAmounts] = useState('');
  const [offerTimeout, setOfferTimeout] = useState('');
  const [gpsFreshness, setGpsFreshness] = useState('');
  const [averageSpeed, setAverageSpeed] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!settingsQuery.data) return;
    const settings = settingsQuery.data;
    setRadii(settings.searchRadiiKm.join(', '));
    setDurations(settings.stageDurationsMin.join(', '));
    setIncreaseAfter(String(settings.fareIncreaseAfterMin));
    setMaxIncreases(String(settings.maxFareIncreases));
    setIncreaseAmounts(settings.fareIncreaseAmounts.join(', '));
    setOfferTimeout(String(settings.offerTimeoutSec));
    setGpsFreshness(String(settings.gpsFreshnessSec));
    setAverageSpeed(String(settings.averageSpeedKmh));
  }, [settingsQuery.data]);

  const parseNumbers = (value: string) => value.split(',').map((item) => Number(item.trim())).filter((item) => Number.isFinite(item));
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const data = {
      searchRadiiKm: parseNumbers(radii),
      stageDurationsMin: parseNumbers(durations),
      fareIncreaseAfterMin: Number(increaseAfter),
      maxFareIncreases: Number(maxIncreases),
      fareIncreaseAmounts: parseNumbers(increaseAmounts),
      offerTimeoutSec: Number(offerTimeout),
      gpsFreshnessSec: Number(gpsFreshness),
      averageSpeedKmh: Number(averageSpeed),
    };
    if (!data.searchRadiiKm.length || data.searchRadiiKm.length !== data.stageDurationsMin.length || data.searchRadiiKm.some((radius, index) => index > 0 && radius <= data.searchRadiiKm[index - 1]!) || !data.fareIncreaseAmounts.length || ![data.fareIncreaseAfterMin, data.maxFareIncreases, data.offerTimeoutSec, data.gpsFreshnessSec, data.averageSpeedKmh].every(Number.isFinite)) {
      setError('Vérifie les listes, les rayons croissants et les valeurs numériques.');
      return;
    }
    setError('');
    updateSettings.mutate({ data }, {
      onSuccess: (updated) => queryClient.setQueryData(getGetDispatchSettingsQueryKey(), updated),
      onError: () => setError('Les paramètres n’ont pas pu être enregistrés.'),
    });
  };

  if (settingsQuery.isLoading) return <SkeletonBlock className="h-96" />;
  if (settingsQuery.isError) return <ErrorState retry={() => settingsQuery.refetch()} label="Les paramètres de dispatch sont indisponibles" />;
  return <form onSubmit={save} className="rounded-[24px] border border-border bg-card p-5" data-testid="form-dispatch-settings"><div className="mb-5 flex items-start justify-between gap-3"><div><p className="mono text-[10px] font-bold uppercase tracking-[.18em] text-muted-foreground">Règles administrables</p><h3 className="mt-1 text-xl font-bold">Paramètres du dispatch</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Les offres partent du plus proche et progressent sans hausse automatique.</p></div><Gauge className="h-5 w-5 text-accent" /></div><div className="space-y-3"><SettingsField label="Rayons (km), croissants" value={radii} onChange={setRadii} testId="input-dispatch-radii" /><SettingsField label="Durée de chaque étape (min)" value={durations} onChange={setDurations} testId="input-dispatch-durations" /><div className="grid grid-cols-2 gap-3"><SettingsField label="Hausse après (min)" value={increaseAfter} onChange={setIncreaseAfter} testId="input-dispatch-increase-after" type="number" /><SettingsField label="Nombre max de hausses" value={maxIncreases} onChange={setMaxIncreases} testId="input-dispatch-max-increases" type="number" /></div><SettingsField label="Montants des hausses (FCFA)" value={increaseAmounts} onChange={setIncreaseAmounts} testId="input-dispatch-increase-amounts" /><div className="grid grid-cols-2 gap-3"><SettingsField label="Expiration offre (sec)" value={offerTimeout} onChange={setOfferTimeout} testId="input-dispatch-offer-timeout" type="number" /><SettingsField label="GPS frais pendant (sec)" value={gpsFreshness} onChange={setGpsFreshness} testId="input-dispatch-gps-freshness" type="number" /></div><SettingsField label="Vitesse moyenne estimée (km/h)" value={averageSpeed} onChange={setAverageSpeed} testId="input-dispatch-average-speed" type="number" /></div>{error && <p className="mt-3 text-xs font-semibold text-destructive" data-testid="text-dispatch-settings-error">{error}</p>}<button type="submit" disabled={updateSettings.isPending} className="mt-5 w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground shadow-[0_3px_0_hsl(160_56%_20%)] disabled:opacity-50" data-testid="button-save-dispatch-settings">{updateSettings.isPending ? 'Enregistrement…' : 'Enregistrer les paramètres'}</button></form>;
}

function SettingsField({ label, value, onChange, testId, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; testId: string; type?: string }) {
  return <label className="block"><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary" data-testid={testId} />{testId === 'input-dispatch-radii' && <RepositionSettingsPanel />}</label>;
}

function RepositionSettingsPanel() {
  const queryClient = useQueryClient();
  const settingsQuery = useGetRepositionSettings({ query: { staleTime: 30000, queryKey: getGetRepositionSettingsQueryKey() } });
  const updateSettings = useUpdateRepositionSettings();
  const [enabled, setEnabled] = useState(true);
  const [duration, setDuration] = useState('30');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!settingsQuery.data) return;
    setEnabled(settingsQuery.data.enabled);
    setDuration(String(settingsQuery.data.recommendationDurationMin));
  }, [settingsQuery.data]);

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const recommendationDurationMin = Number(duration);
    if (!Number.isFinite(recommendationDurationMin) || recommendationDurationMin < 1 || recommendationDurationMin > 240) {
      setError('La durée doit être comprise entre 1 et 240 minutes.');
      return;
    }
    setError('');
    updateSettings.mutate({ data: { enabled, recommendationDurationMin } }, {
      onSuccess: (updated) => queryClient.setQueryData(getGetRepositionSettingsQueryKey(), updated),
      onError: () => setError('Les paramètres de recommandation n’ont pas pu être enregistrés.'),
    });
  };

  if (settingsQuery.isLoading) return <div className="mt-3 rounded-xl bg-muted p-3 text-xs text-muted-foreground">Chargement des recommandations…</div>;
  if (settingsQuery.isError) return <div className="mt-3 rounded-xl bg-destructive/10 p-3 text-xs font-semibold text-destructive">Paramètres de recommandation indisponibles.</div>;
  return <div className="mt-4 rounded-2xl border border-accent/30 bg-secondary/[.1] p-3" data-testid="form-reposition-settings">
    <div className="mb-3"><p className="mono text-[10px] font-bold uppercase tracking-[.14em] text-accent">Après-course</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Recommander une zone sans déplacer automatiquement le chauffeur.</p></div>
    <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} data-testid="checkbox-reposition-enabled" /> Activer les recommandations</label>
    <div className="mt-3"><SettingsField label="Durée d’une recommandation (min)" value={duration} onChange={setDuration} testId="input-reposition-duration" type="number" /></div>
    {error && <p className="mt-2 text-xs font-semibold text-destructive" data-testid="text-reposition-settings-error">{error}</p>}
    <button type="button" onClick={save} disabled={updateSettings.isPending} className="mt-3 w-full rounded-xl border border-primary px-3 py-2 text-xs font-bold text-primary disabled:opacity-50" data-testid="button-save-reposition-settings">{updateSettings.isPending ? 'Enregistrement…' : 'Enregistrer'}</button>
  </div>;
}

function DemandForecastPanel() {
  const queryClient = useQueryClient();
  const forecastQuery = useGetDemandForecast({ query: { staleTime: 15000, refetchInterval: 20000, queryKey: getGetDemandForecastQueryKey() } });
  const settingsQuery = useGetDemandForecastSettings({ query: { staleTime: 30000, queryKey: getGetDemandForecastSettingsQueryKey() } });
  const updateSettings = useUpdateDemandForecastSettings();
  const [enabled, setEnabled] = useState(true);
  const [minimumDataPoints, setMinimumDataPoints] = useState('12');
  const [forecastHorizonHours, setForecastHorizonHours] = useState('2');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!settingsQuery.data) return;
    setEnabled(settingsQuery.data.enabled);
    setMinimumDataPoints(String(settingsQuery.data.minimumDataPoints));
    setForecastHorizonHours(String(settingsQuery.data.forecastHorizonHours));
  }, [settingsQuery.data]);

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const data = {
      enabled,
      minimumDataPoints: Number(minimumDataPoints),
      forecastHorizonHours: Number(forecastHorizonHours),
    };
    if (!Number.isInteger(data.minimumDataPoints) || data.minimumDataPoints < 1 || data.minimumDataPoints > 10000 || !Number.isInteger(data.forecastHorizonHours) || data.forecastHorizonHours < 1 || data.forecastHorizonHours > 12) {
      setError('Le seuil doit être entier et l’horizon compris entre 1 et 12 heures.');
      return;
    }
    setError('');
    updateSettings.mutate({ data }, {
      onSuccess: (updated) => {
        queryClient.setQueryData(getGetDemandForecastSettingsQueryKey(), updated);
        queryClient.invalidateQueries({ queryKey: getGetDemandForecastQueryKey() });
      },
      onError: () => setError('Les paramètres de prévision n’ont pas pu être enregistrés.'),
    });
  };

  const levelLabel = (level: string) => level === 'high' ? 'élevée' : level === 'normal' ? 'normale' : level === 'low' ? 'faible' : 'Données insuffisantes';
  const levelTone = (level: string) => level === 'high' ? 'bg-destructive/10 text-destructive' : level === 'normal' ? 'bg-secondary/30 text-foreground' : level === 'low' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground';
  const formatProbability = (value: number) => `${Math.round(value * 100)} %`;

  return <div className="rounded-[24px] border border-border bg-card p-5" data-testid="section-demand-forecast">
    <div className="mb-5 flex items-start justify-between gap-3"><div><p className="mono text-[10px] font-bold uppercase tracking-[.18em] text-muted-foreground">Estimation courte</p><h3 className="mt-1 text-xl font-bold">Prévision de demande</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Une indication probabiliste, jamais une certitude. Les zones restent la source de référence.</p></div><Gauge className="h-5 w-5 text-accent" /></div>
    {settingsQuery.isLoading ? <SkeletonBlock className="h-40" /> : settingsQuery.isError ? <ErrorState retry={() => settingsQuery.refetch()} label="Les paramètres de prévision sont indisponibles" /> : <form onSubmit={save} className="rounded-2xl bg-muted/50 p-3" data-testid="form-demand-forecast-settings">
      <div className="grid gap-3"><label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} data-testid="checkbox-demand-forecast-enabled" /> Activer</label><SettingsField label="Seuil minimal de données" value={minimumDataPoints} onChange={setMinimumDataPoints} testId="input-demand-forecast-minimum" type="number" /><SettingsField label="Horizon (heures)" value={forecastHorizonHours} onChange={setForecastHorizonHours} testId="input-demand-forecast-horizon" type="number" /></div>
      {error && <p className="mt-2 text-xs font-semibold text-destructive" data-testid="text-demand-forecast-settings-error">{error}</p>}
      <button type="submit" disabled={updateSettings.isPending} className="mt-3 w-full rounded-xl border border-primary px-3 py-2.5 text-xs font-bold text-primary disabled:opacity-50" data-testid="button-save-demand-forecast-settings">{updateSettings.isPending ? 'Enregistrement…' : 'Enregistrer les paramètres de prévision'}</button>
    </form>}
    {!enabled || forecastQuery.data?.enabled === false ? <div className="mt-4 rounded-2xl border border-border bg-muted p-4 text-sm font-semibold text-muted-foreground" data-testid="text-demand-forecast-disabled">Prévision désactivée. Aucune estimation n’est calculée.</div> : forecastQuery.isLoading ? <div className="mt-4 space-y-2"><SkeletonBlock className="h-24" /><SkeletonBlock className="h-24" /></div> : forecastQuery.isError ? <div className="mt-4"><ErrorState retry={() => forecastQuery.refetch()} label="Les prévisions sont indisponibles" /></div> : <div className="mt-4 space-y-3">{(forecastQuery.data?.zones ?? []).map((zone) => <div key={zone.zoneId} className="rounded-2xl border border-border p-4" data-testid={`forecast-zone-${zone.zoneId}`}><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-bold">{zone.zoneName}</p><p className="mt-1 text-xs text-muted-foreground">Chauffeurs disponibles : {zone.availableDrivers}</p></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${levelTone(zone.level)}`}>{levelLabel(zone.level)}</span></div>{zone.level === 'insufficient' ? <p className="mt-3 rounded-xl bg-muted p-3 text-xs font-semibold text-muted-foreground">Données insuffisantes pour produire une prévision dans cette zone.</p> : <><div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4"><ZoneStat label="Estimation/h" value={zone.expectedDemandPerHour ?? '—'} /><ZoneStat label="Récent/h" value={zone.recentDemandPerHour ?? '—'} /><ZoneStat label="Historique/h" value={zone.comparableDemandPerHour ?? '—'} /><ZoneStat label="Évolution récente" value={zone.recentTrendPercent === null ? '—' : `${zone.recentTrendPercent}%`} /></div>{zone.probabilities && <p className="mt-3 text-xs font-semibold text-muted-foreground">Probabilités : faible {formatProbability(zone.probabilities.low)} · normale {formatProbability(zone.probabilities.normal)} · élevée {formatProbability(zone.probabilities.high)}</p>}<div className="mt-3 grid gap-2 sm:grid-cols-2">{zone.hourly.map((slot) => <div key={slot.hour} className="rounded-xl bg-muted/60 p-2.5 text-xs"><div className="flex justify-between gap-2 font-bold"><span>{new Date(slot.hour).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span><span>{slot.estimatedDemandPerHour ?? '—'}/h estimée</span></div><p className="mt-1 text-muted-foreground">Observé {slot.observedDemand} · comparable {slot.comparableDemand}</p></div>)}</div></>}</div>)}</div>}
  </div>;
}

function DriverRepositionCard() {
  const queryClient = useQueryClient();
  const driversQuery = useListDrivers({ query: { staleTime: 15000, refetchInterval: 15000, queryKey: getListDriversQueryKey() } });
  const driver = (driversQuery.data ?? []).find((item) => item.status === 'available') ?? driversQuery.data?.[0];
  const recommendationQuery = useGetDriverRepositionRecommendation(driver?.id ?? 0, { query: { enabled: Boolean(driver?.id), staleTime: 3000, refetchInterval: 5000, queryKey: getGetDriverRepositionRecommendationQueryKey(driver?.id ?? 0) } });
  const respond = useRespondToDriverRepositionRecommendation();
  const [message, setMessage] = useState('');
  const recommendation = recommendationQuery.data?.recommendation;

  const respondToRecommendation = (decision: 'accept' | 'ignore' | 'dismiss') => {
    if (!driver || !recommendation) return;
    respond.mutate({ id: driver.id, recommendationId: recommendation.id, data: { decision } }, {
      onSuccess: () => {
        setMessage(decision === 'accept' ? 'Recommandation acceptée. Le déplacement reste entièrement à votre choix.' : decision === 'ignore' ? 'Recommandation ignorée.' : 'Recommandation fermée.');
        queryClient.invalidateQueries({ queryKey: getGetDriverRepositionRecommendationQueryKey(driver.id) });
      },
    });
  };

  if (!recommendation && !message) return null;
  return <div className="fixed bottom-5 right-5 z-40 w-[min(380px,calc(100vw-2rem))] rounded-2xl border border-accent/30 bg-card p-4 shadow-2xl" data-testid="card-reposition-recommendation">
    <div className="flex items-start justify-between gap-3"><div><p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-accent">Après votre course</p>{recommendation ? <h3 className="mt-1 text-lg font-bold">Zone conseillée : {recommendation.zoneName}</h3> : <p className="mt-1 text-sm font-bold">{message}</p>}</div><Sparkles className="h-5 w-5 shrink-0 text-accent" /></div>
    {recommendation && <><p className="mt-3 text-sm leading-relaxed text-muted-foreground">{recommendation.reason}</p><p className="mt-2 text-xs font-semibold text-muted-foreground">{recommendation.distanceToZoneKm} km · {recommendation.availableDrivers} chauffeur(s) déjà disponible(s)</p><div className="mt-4 grid grid-cols-3 gap-2"><button onClick={() => respondToRecommendation('accept')} disabled={respond.isPending} className="rounded-xl bg-primary px-2 py-2.5 text-xs font-bold text-primary-foreground disabled:opacity-50" data-testid="button-accept-reposition">Accepter</button><button onClick={() => respondToRecommendation('ignore')} disabled={respond.isPending} className="rounded-xl border border-border px-2 py-2.5 text-xs font-bold disabled:opacity-50" data-testid="button-ignore-reposition">Ignorer</button><button onClick={() => respondToRecommendation('dismiss')} disabled={respond.isPending} className="rounded-xl border border-border px-2 py-2.5 text-xs font-bold text-destructive disabled:opacity-50" data-testid="button-dismiss-reposition">Fermer</button></div></>}
  </div>;
}

function VirtualZonesPanel() {
  const queryClient = useQueryClient();
  const zonesQuery = useListVirtualZones({ query: { staleTime: 15000, refetchInterval: 20000, queryKey: getListVirtualZonesQueryKey() } });
  const createZone = useCreateVirtualZone();
  const updateZone = useUpdateVirtualZone();
  const [editingId, setEditingId] = useState<number>();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [latitude, setLatitude] = useState('6.877');
  const [longitude, setLongitude] = useState('-6.45');
  const [radius, setRadius] = useState('2');
  const [lowThreshold, setLowThreshold] = useState('1');
  const [highThreshold, setHighThreshold] = useState('3');
  const [minSampleSize, setMinSampleSize] = useState('3');
  const [error, setError] = useState('');
  const zones = zonesQuery.data ?? [];
  const selected = zones.find((zone) => zone.id === editingId);
  const statsQuery = useGetVirtualZoneStats(editingId ?? 0, { query: { enabled: Boolean(editingId), staleTime: 15000, refetchInterval: 20000, queryKey: getGetVirtualZoneStatsQueryKey(editingId ?? 0) } });

  useEffect(() => {
    if (!creating && editingId === undefined && zones[0]) setEditingId(zones[0].id);
  }, [creating, editingId, zones]);

  useEffect(() => {
    if (!selected || creating) return;
    setName(selected.name);
    setDescription(selected.description ?? '');
    setLatitude(String(selected.centerLatitude));
    setLongitude(String(selected.centerLongitude));
    setRadius(String(selected.radiusKm));
    setLowThreshold(String(selected.lowDemandPerHour));
    setHighThreshold(String(selected.highDemandPerHour));
    setMinSampleSize(String(selected.minSampleSize));
  }, [creating, selected]);

  const startNew = () => {
    setCreating(true);
    setEditingId(undefined);
    setName('');
    setDescription('');
    setLatitude('6.877');
    setLongitude('-6.45');
    setRadius('2');
    setLowThreshold('1');
    setHighThreshold('3');
    setMinSampleSize('3');
    setError('');
  };

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const data = {
      name: name.trim(),
      description: description.trim() || undefined,
      centerLatitude: Number(latitude),
      centerLongitude: Number(longitude),
      radiusKm: Number(radius),
      lowDemandPerHour: Number(lowThreshold),
      highDemandPerHour: Number(highThreshold),
      minSampleSize: Number(minSampleSize),
    };
    if (data.name.length < 2 || ![data.centerLatitude, data.centerLongitude, data.radiusKm, data.lowDemandPerHour, data.highDemandPerHour, data.minSampleSize].every(Number.isFinite) || data.radiusKm <= 0 || data.highDemandPerHour <= data.lowDemandPerHour || data.minSampleSize < 1) {
      setError('Vérifie le nom, la géographie et les seuils de la zone.');
      return;
    }
    setError('');
    if (creating) {
      createZone.mutate({ data }, {
        onSuccess: (zone) => {
          queryClient.invalidateQueries({ queryKey: getListVirtualZonesQueryKey() });
          setCreating(false);
          setEditingId(zone.id);
        },
        onError: () => setError('La zone n’a pas pu être créée.'),
      });
    } else if (editingId) {
      updateZone.mutate({ id: editingId, data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListVirtualZonesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetVirtualZoneStatsQueryKey(editingId) });
        },
        onError: () => setError('La zone n’a pas pu être modifiée.'),
      });
    }
  };

  if (zonesQuery.isLoading) return <SkeletonBlock className="h-[520px]" />;
  if (zonesQuery.isError) return <ErrorState retry={() => zonesQuery.refetch()} label="Les zones virtuelles sont indisponibles" />;

  const levelTone = statsQuery.data?.demandLevel === 'high'
    ? 'bg-destructive/10 text-destructive'
    : statsQuery.data?.demandLevel === 'medium'
      ? 'bg-secondary/30 text-foreground'
      : statsQuery.data?.demandLevel === 'low'
        ? 'bg-primary/10 text-primary'
        : 'bg-muted text-muted-foreground';
  return <div className="space-y-6"><DemandForecastPanel /><div className="rounded-[24px] border border-border bg-card p-5" data-testid="section-virtual-zones">
    <div className="mb-5 flex items-start justify-between gap-3">
      <div><p className="mono text-[10px] font-bold uppercase tracking-[.18em] text-muted-foreground">Analyse locale</p><h3 className="mt-1 text-xl font-bold">Zones virtuelles</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Statistiques de demande sans prédiction ni majoration.</p></div>
      <MapPin className="h-5 w-5 text-accent" />
    </div>
    <div className="flex gap-2">
      <select value={creating ? '' : String(editingId ?? '')} onChange={(event) => { setCreating(false); setEditingId(Number(event.target.value)); }} className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-semibold" aria-label="Zone sélectionnée" data-testid="select-virtual-zone">
        {zones.length === 0 && <option value="">Aucune zone</option>}
        {zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
      </select>
      <button type="button" onClick={startNew} className="rounded-xl border border-border px-3 py-2 text-xs font-bold hover:bg-muted" data-testid="button-new-virtual-zone">Nouvelle zone</button>
    </div>
    <form onSubmit={save} className="mt-4 space-y-3">
      <div className="grid grid-cols-2 gap-3"><SettingsField label="Nom" value={name} onChange={setName} testId="input-zone-name" /><SettingsField label="Rayon (km)" value={radius} onChange={setRadius} testId="input-zone-radius" type="number" /></div>
      <SettingsField label="Description" value={description} onChange={setDescription} testId="input-zone-description" />
      <div className="grid grid-cols-2 gap-3"><SettingsField label="Latitude centre" value={latitude} onChange={setLatitude} testId="input-zone-latitude" type="number" /><SettingsField label="Longitude centre" value={longitude} onChange={setLongitude} testId="input-zone-longitude" type="number" /></div>
      <div className="grid grid-cols-3 gap-2"><SettingsField label="Seuil faible/h" value={lowThreshold} onChange={setLowThreshold} testId="input-zone-low-threshold" type="number" /><SettingsField label="Seuil forte/h" value={highThreshold} onChange={setHighThreshold} testId="input-zone-high-threshold" type="number" /><SettingsField label="Échantillon min." value={minSampleSize} onChange={setMinSampleSize} testId="input-zone-min-sample" type="number" /></div>
      {error && <p className="text-xs font-semibold text-destructive" data-testid="text-zone-error">{error}</p>}
      <button type="submit" disabled={createZone.isPending || updateZone.isPending} className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground shadow-[0_3px_0_hsl(160_56%_20%)] disabled:opacity-50" data-testid="button-save-virtual-zone">{createZone.isPending || updateZone.isPending ? 'Enregistrement…' : creating ? 'Créer la zone' : 'Enregistrer la zone'}</button>
    </form>
    {selected && <div className="mt-5 border-t border-border pt-4" data-testid="section-zone-stats">
      <div className="flex items-center justify-between"><p className="text-sm font-bold">Dernières 24 heures</p>{statsQuery.data && <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${levelTone}`}>{statsQuery.data.demandLevel === 'high' ? '🔴' : statsQuery.data.demandLevel === 'medium' ? '🟡' : statsQuery.data.demandLevel === 'low' ? '🟢' : '•'} {statsQuery.data.demandLevelLabel}</span>}</div>
      {statsQuery.isLoading ? <SkeletonBlock className="mt-3 h-24" /> : statsQuery.isError ? <p className="mt-3 text-xs text-muted-foreground">Statistiques indisponibles.</p> : statsQuery.data && <div className="mt-3 grid grid-cols-2 gap-2 text-xs"><ZoneStat label="Demandes" value={statsQuery.data.demands} /><ZoneStat label="Terminées" value={statsQuery.data.completedTrips} /><ZoneStat label="Demandes/h" value={statsQuery.data.demandsPerHour} /><ZoneStat label="Chauffeurs disponibles" value={statsQuery.data.availableDrivers} /><ZoneStat label="Recherche moyenne" value={statsQuery.data.averageSearchTimeSec === null ? '—' : `${statsQuery.data.averageSearchTimeSec}s`} /><ZoneStat label="Attente moyenne" value={statsQuery.data.averageWaitTimeSec === null ? '—' : `${statsQuery.data.averageWaitTimeSec}s`} /><ZoneStat label="Refus" value={statsQuery.data.refusals} /><ZoneStat label="Annulations" value={statsQuery.data.cancellations} /></div>}
    </div>}
  </div></div>;
}

function ZoneStat({ label, value }: { label: string; value: number | string }) {
  return <div className="rounded-xl bg-muted/60 p-2.5"><p className="text-[10px] text-muted-foreground">{label}</p><p className="mt-1 font-bold">{value}</p></div>;
}

function DriverRoster({ drivers, loading, error, retry }: { drivers: Driver[]; loading: boolean; error: boolean; retry: () => void }) {
  return <div className="rounded-[24px] border border-border bg-card p-5" data-testid="section-drivers"><div className="mb-5 flex items-center justify-between"><div><p className="mono text-[10px] font-bold uppercase tracking-[.18em] text-muted-foreground">Vue de la flotte</p><h3 className="mt-1 text-xl font-bold">Chauffeurs</h3></div><UsersRound className="h-5 w-5 text-accent" /></div>{loading ? <div className="space-y-3"><SkeletonBlock className="h-12" /><SkeletonBlock className="h-12" /></div> : error ? <ErrorState retry={retry} /> : drivers.length === 0 ? <EmptyState title="Aucun chauffeur connecté" copy="Les chauffeurs connectés apparaîtront ici." /> : <div className="space-y-2">{drivers.slice(0, 5).map((driver) => <div key={driver.id} className="flex items-center gap-3 rounded-xl p-2.5" data-testid={`driver-${driver.id}`}><div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{driver.name.slice(0, 2).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{driver.name}</p><p className="truncate text-[11px] text-muted-foreground">{driver.vehicle} · {driver.plate}</p></div><div className="text-right"><p className="flex items-center gap-1 text-xs font-bold"><Star className="h-3 w-3 fill-secondary text-secondary" />{driver.rating.toFixed(1)}</p><p className={`mt-1 text-[10px] font-bold ${driver.status === 'available' ? 'text-primary' : driver.status === 'on_trip' ? 'text-accent' : 'text-muted-foreground'}`}>{driver.status === 'on_trip' ? 'En course' : driver.status === 'available' ? 'Disponible' : 'Hors ligne'}</p></div></div>)}</div>}</div>;
}

function AppRouter() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Switch><Route path="/" component={PassengerHome} /><Route path="/driver" component={DriverHome} /><Route path="/operations" component={Operations} /><Route component={NotFound} /></Switch></ErrorBoundary>;
}


function RealtimeTripSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const apiBase = (import.meta.env.VITE_API_BASE_URL || window.location.origin).replace(/\/$/, "");
    const socketUrl = apiBase.replace(/^http/, "ws") + "/api/realtime";
    let socket: WebSocket | undefined;
    let reconnectTimer: number | undefined;
    let stopped = false;

    const refreshCourseQueries = (trip?: Trip) => {
      if (trip) {
        queryClient.setQueryData(getGetTripQueryKey(trip.id), trip);
        for (const role of ["passenger", "driver", "admin"] as const) {
          queryClient.setQueryData<Trip[] | undefined>(getListTripsQueryKey({ role }), (current) => {
            if (!current) return current;
            return current.map((item) => item.id === trip.id ? trip : item);
          });
        }
        queryClient.invalidateQueries({ queryKey: getGetTripQueryKey(trip.id) });
      }
      queryClient.invalidateQueries({ queryKey: getListTripsQueryKey({ role: "passenger" }) });
      queryClient.invalidateQueries({ queryKey: getListTripsQueryKey({ role: "driver" }) });
      queryClient.invalidateQueries({ queryKey: getListTripsQueryKey({ role: "admin" }) });
      queryClient.invalidateQueries({ queryKey: getListDriversQueryKey() });
      queryClient.invalidateQueries({ predicate: ({ queryKey }) => String(queryKey[0]).startsWith("/api/dispatch/offers") });
    };

    const connect = () => {
      socket = new WebSocket(socketUrl);
      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        try {
          const message = JSON.parse(event.data) as { type?: string; trip?: Trip };
          if (message.type === "trip.created" || message.type === "trip.updated") {
            refreshCourseQueries(message.trip);
          }
        } catch {
          // Ignore malformed realtime frames and keep the connection alive.
        }
      };
      socket.onclose = () => {
        if (!stopped) reconnectTimer = window.setTimeout(connect, 1500);
      };
      socket.onerror = () => socket?.close();
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [queryClient]);

  return null;
}
function App() {
  return <QueryClientProvider client={queryClient}><RealtimeTripSync /><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><AppRouter /></WouterRouter><Toaster /><InstallPrompt /></TooltipProvider></QueryClientProvider>;
}

export default App;