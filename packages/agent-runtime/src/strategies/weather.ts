import { BaseStrategy, MutableAgentState, untilAborted } from '../strategy.js'

/**
 * Serves live weather data from [Open-Meteo](https://open-meteo.com/) (no API key required).
 *
 * Send a message to trigger a lookup:
 * - `{"city":"London"}` — geocode city name then fetch weather
 * - `{"lat":51.5,"lon":-0.1}` — skip geocoding, fetch directly
 * - `"Tokyo"` — plain city name (same as `{"city":"Tokyo"}`)
 *
 * Returns a JSON string with `city`, `temperature_c/f`, `humidity_pct`, `wind_mph`,
 * `condition`, and `fetched_at` fields.
 *
 * Mirrors the Rust `WeatherStrategy`.
 */
export class WeatherStrategy extends BaseStrategy {
  readonly name = 'weather'

  async run(state: MutableAgentState, signal: AbortSignal): Promise<void> {
    state.recordAction('strategy-start', 'WeatherStrategy ready — send {"city":"London"} to get live weather')
    await untilAborted(signal)
  }

  async handleMessage(text: string, state: MutableAgentState): Promise<string> {
    const start = Date.now()
    try {
      const result = await fetchWeather(text)
      const latency = Date.now() - start
      state.recordAction('data-delivered', `${result.city ?? 'unknown'} (${latency} ms)`)
      return JSON.stringify(result, null, 2)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      state.recordAction('rpc-error', msg)
      return JSON.stringify({ error: msg })
    }
  }
}

interface WeatherResult {
  city: string
  lat: number
  lon: number
  temperature_c: number
  temperature_f: number
  humidity_pct: number
  wind_mph: number
  condition: string
  weather_code: number
  source: string
  fetched_at: string
}

/**
 * Top-level weather lookup. Accepts JSON or a plain city string.
 * Geocodes the city if lat/lon are not provided directly.
 */
async function fetchWeather(text: string): Promise<WeatherResult> {
  let lat: number, lon: number, cityName: string

  let parsed: Record<string, unknown> | null = null
  try { parsed = JSON.parse(text) as Record<string, unknown> } catch { /* plain text */ }

  if (parsed && typeof parsed.lat === 'number' && typeof parsed.lon === 'number') {
    lat = parsed.lat
    lon = parsed.lon
    cityName = typeof parsed.city === 'string' ? parsed.city : 'unknown'
  } else {
    const city = typeof parsed?.city === 'string' ? parsed.city : text.trim()
    if (!city) throw new Error('expected {"city":"London"} or {"lat":51.5,"lon":-0.1}')
    ;({ lat, lon, cityName } = await geocode(city))
  }

  return fetchForecast(lat, lon, cityName)
}

/**
 * Resolve a city name to coordinates using the Open-Meteo geocoding API.
 * @throws if the city name is not found or the request fails.
 */
async function geocode(city: string): Promise<{ lat: number; lon: number; cityName: string }> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`geocoding request failed: ${res.status}`)
  const data = await res.json() as { results?: Array<{ latitude: number; longitude: number; name: string }> }
  const first = data.results?.[0]
  if (!first) throw new Error(`city '${city}' not found`)
  return { lat: first.latitude, lon: first.longitude, cityName: first.name }
}

/**
 * Fetch the current conditions for a lat/lon pair from the Open-Meteo forecast API.
 * Returns temperature in both Celsius and Fahrenheit, humidity, wind speed, and a WMO condition label.
 */
async function fetchForecast(lat: number, lon: number, cityName: string): Promise<WeatherResult> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code` +
    `&wind_speed_unit=mph&timezone=auto`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`weather request failed: ${res.status}`)
  const data = await res.json() as {
    current: {
      temperature_2m: number
      relative_humidity_2m: number
      wind_speed_10m: number
      weather_code: number
    }
  }
  const c = data.current
  const tempC = c.temperature_2m
  return {
    city: cityName,
    lat, lon,
    temperature_c: tempC,
    temperature_f: Math.round((tempC * 9 / 5 + 32) * 10) / 10,
    humidity_pct: c.relative_humidity_2m,
    wind_mph: c.wind_speed_10m,
    condition: wmoLabel(c.weather_code),
    weather_code: c.weather_code,
    source: 'open-meteo.com (no API key)',
    fetched_at: new Date().toISOString(),
  }
}

/**
 * Translate a WMO weather interpretation code to a human-readable label.
 * Code table: https://open-meteo.com/en/docs#weathervariables
 */
function wmoLabel(code: number): string {
  if (code === 0) return 'Clear sky'
  if (code === 1) return 'Mainly clear'
  if (code === 2) return 'Partly cloudy'
  if (code === 3) return 'Overcast'
  if (code === 45 || code === 48) return 'Foggy'
  if (code >= 51 && code <= 55) return 'Drizzle'
  if (code >= 61 && code <= 65) return 'Rain'
  if (code >= 71 && code <= 75) return 'Snow'
  if (code >= 80 && code <= 82) return 'Rain showers'
  if (code === 95) return 'Thunderstorm'
  if (code === 96 || code === 99) return 'Thunderstorm with hail'
  return 'Unknown'
}
