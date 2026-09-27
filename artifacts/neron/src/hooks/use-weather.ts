import { useEffect, useRef, useState } from 'react';

export type WeatherIconKey = 'sun' | 'cloud-sun' | 'cloud' | 'cloud-rain' | 'cloud-snow' | 'wind';

export interface WeatherData {
  temp: number;
  condition: string;
  icon: WeatherIconKey;
}

interface UseWeatherResult {
  weather: WeatherData | null;
  loading: boolean;
  error: string | null;
}

// Coordonnées par défaut si la géolocalisation est refusée/indisponible.
// Surchageable via VITE_WEATHER_LAT / VITE_WEATHER_LON si la homebox est ailleurs.
const DEFAULT_LAT = Number(import.meta.env.VITE_WEATHER_LAT ?? 48.2973);
const DEFAULT_LON = Number(import.meta.env.VITE_WEATHER_LON ?? 4.0744);

const GEOLOCATION_TIMEOUT_MS = 5000;
const GEOLOCATION_MAX_AGE_MS = 10 * 60 * 1000;
const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 min
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // refetch au retour au premier plan si > 10 min
const WINDY_THRESHOLD_KMH = 40;

// Table d'interprétation WMO (https://open-meteo.com/en/docs) → libellé FR + icône.
function conditionFromCode(code: number): { label: string; icon: WeatherIconKey } {
  if (code === 0) return { label: 'Ciel dégagé', icon: 'sun' };
  if (code === 1) return { label: 'Plutôt dégagé', icon: 'cloud-sun' };
  if (code === 2) return { label: 'Partiellement nuageux', icon: 'cloud-sun' };
  if (code === 3) return { label: 'Nuageux', icon: 'cloud' };
  if (code === 45 || code === 48) return { label: 'Brouillard', icon: 'cloud' };
  if ([51, 53, 55, 56, 57].includes(code)) return { label: 'Bruine', icon: 'cloud-rain' };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { label: 'Pluie', icon: 'cloud-rain' };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { label: 'Neige', icon: 'cloud-snow' };
  if ([95, 96, 99].includes(code)) return { label: 'Orage', icon: 'cloud-rain' };
  return { label: 'Nuageux', icon: 'cloud' };
}

function getPosition(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({ lat: DEFAULT_LAT, lon: DEFAULT_LON });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve({ lat: DEFAULT_LAT, lon: DEFAULT_LON }),
      { timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: GEOLOCATION_MAX_AGE_MS },
    );
  });
}

/**
 * Récupère la météo actuelle (Open-Meteo, aucune clé API requise) en se
 * basant sur la géolocalisation navigateur, avec repli sur des coordonnées
 * par défaut si la géolocalisation est refusée ou indisponible.
 *
 * Ne renvoie jamais de données inventées : en cas d'échec, `weather` reste
 * `null` et `error` est renseigné — à l'appelant de ne pas afficher le
 * widget plutôt que d'afficher une valeur trompeuse.
 */
export function useWeather(): UseWeatherResult {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastFetchedAtRef = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;

    async function fetchWeather() {
      setLoading(true);
      try {
        const { lat, lon } = await getPosition();

        const url = new URL('https://api.open-meteo.com/v1/forecast');
        url.searchParams.set('latitude', String(lat));
        url.searchParams.set('longitude', String(lon));
        url.searchParams.set('current', 'temperature_2m,weather_code,wind_speed_10m');
        url.searchParams.set('timezone', 'auto');

        const res = await fetch(url.toString());
        if (!res.ok) throw new Error(`Open-Meteo a répondu ${res.status}`);

        const data = await res.json();
        const current = data?.current;
        if (!current || typeof current.temperature_2m !== 'number') {
          throw new Error('Réponse météo invalide');
        }

        if (cancelled) return;

        const { label, icon } = conditionFromCode(current.weather_code);
        const isWindy =
          typeof current.wind_speed_10m === 'number' && current.wind_speed_10m >= WINDY_THRESHOLD_KMH;

        setWeather({
          temp: Math.round(current.temperature_2m),
          condition: isWindy ? 'Venteux' : label,
          icon: isWindy ? 'wind' : icon,
        });
        setError(null);
        lastFetchedAtRef.current = Date.now();
      } catch (err) {
        if (!cancelled) {
          setWeather(null);
          setError(err instanceof Error ? err.message : 'Erreur météo');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchWeather();
    const interval = setInterval(fetchWeather, REFRESH_INTERVAL_MS);

    // Refetch au retour au premier plan (écran réveillé, onglet refocalisé)
    // si la dernière donnée récupérée commence à dater.
    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastFetchedAtRef.current >= STALE_THRESHOLD_MS) {
        fetchWeather();
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return { weather, loading, error };
}
