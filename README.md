# Race Telemetry Analyzer

Analiza telemetrii wyścigowej z loggera **AiM Solo 2 DL** w przeglądarce.
Vite + React + TypeScript · MapLibre GL (satelita Esri) · Supabase (Storage + Postgres + Auth) · Vercel.

Pełna specyfikacja: [`docs/SPEC.md`](docs/SPEC.md).

## Zasada nadrzędna

Surowa telemetria **nigdy** nie trafia do Postgresa jako wiersze. Postgres = indeks + podsumowania
(`sessions`, `laps`, `sectors`). Pliki (`raw`) i przesamplowany kompakt JSON (`processed`) = Supabase
Storage. Cała analiza dzieje się w przeglądarce.

## Szybki start (lokalnie)

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # testy parsera + geometrii
npm run build      # produkcyjny build
```

Aplikacja działa **bez Supabase** (tryb lokalny): przeciągnij CSV, analizuj mapę/wykresy/deltę.
Upload i lista sesji włączają się po skonfigurowaniu `.env` i zalogowaniu.

## Supabase

1. Utwórz projekt na supabase.com.
2. Wykonaj migrację `supabase/migrations/0001_init.sql` (SQL Editor). Tworzy tabele, RLS,
   buckety `raw`/`processed` i polityki Storage.
3. Skopiuj `.env.example` → `.env` i uzupełnij `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
4. Auth: email / magic-link (włączone domyślnie).

## Vercel

- Framework preset: **Vite**. Build: `npm run build`, output: `dist`.
- Ustaw zmienne środowiskowe `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- `vercel.json` zawiera SPA-rewrite.

## Pipeline (Kamień Milowy #1)

Upload CSV → parse (okrążenia z beacon markers) → raw + processed JSON do Storage →
insert `sessions`/`laps` → lista sesji → otwarcie → mapa satelitarna. Po wczytaniu w konsoli:
liczba okrążeń, best lap, delta na 100%, martwe kanały, częstotliwość.

## Fixture akceptacyjny

`sample/4.csv` (Tor Poznań) to fixture kryteriów akceptacji — **wgraj realny plik z RS3**
(patrz `sample/README.md`). Testy jednostkowe używają syntetycznego fixture w `src/lib/testFixture.ts`.

## Funkcje

Wczytanie CSV (drag/drop + picker) · mapa satelitarna + linie GPS okrążeń + kursor ·
wybór ≥2 okrążeń · suwak + Play (sync po dystansie) · odczyt prędkości każdego okrążenia ·
kolor linii wg okrążenia / heatmapa prędkości · delta-time po dystansie · wykres prędkość vs dystans ·
ręczny offset satelity (per tor, localStorage) · Fit do obrysu toru.
