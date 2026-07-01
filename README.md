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

Migracja jest już zastosowana w istniejącym projekcie (`tracks/sessions/laps/sectors`
+ buckety `raw`/`processed` + RLS). Konfiguracja klienta:

1. Skopiuj `.env.example` → `.env` i uzupełnij `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
   (Project Settings → API). **Klucze nie są commitowane** (`.env` w `.gitignore`).
2. Auth: email / magic-link — zaloguj się raz; wtedy każdy wrzucony CSV zapisuje się
   automatycznie (raw CSV + processed JSON do Storage, indeks do Postgres).

> ⚠️ **Bezpieczeństwo przy współdzielonym projekcie.** Apka używa klucza `anon`, który przy
> tej instancji ma też dostęp do tabel z **wyłączonym RLS** (dane ERP). Zanim wystawisz apkę
> publicznie (Vercel), włącz RLS na tych tabelach albo użyj osobnego projektu Supabase —
> inaczej klucz w bundlu przeglądarki odsłoni te dane. Tabele wyścigowe mają RLS włączone.

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
**symulacja gazu/hamulca z podłużnych przeciążeń** (auto-kalibracja znaku, fallback na dv/dt) ·
ręczny offset satelity (per tor, localStorage) · Fit do obrysu toru ·
auto-zapis do Supabase (magic-link) · responsywny układ (ResizeObserver na mapie).
