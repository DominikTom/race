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

Interfejs roboczy: **sidebar + mapa + dokowany panel z zakładkami** — mapa i dane widoczne
naraz. Zakładki: Prędkość · Delta · Przeciążenia G · Sektory/Zakręty.

Wczytanie CSV (drag/drop + picker) · mapa satelitarna + linie GPS okrążeń + kursor ·
wybór ≥2 okrążeń · **kolor per okrążenie** (color picker) · suwak + Play (sync po dystansie) ·
**kamera podąża za autem** (przełącznik na mapie) · **biegnący licznik czasu okrążenia** ·
kolor linii wg okrążenia / heatmapa prędkości / **wg sektorów** · delta-time po dystansie ·
wykres prędkość vs dystans · **miernik przeciążeń G** (traction circle) · ręczny offset satelity ·
Fit / focus na sektor-zakręt (reszta toru wyszarzona) · auto-zapis do Supabase z dedupem
(tag „już w bazie") · responsywny układ.

### Miernik przeciążeń G

Zakładka „Przeciążenia G": koło przyczepności (traction circle) — oś X = boczne g, oś Y =
wzdłużne g (gaz w górę, hamowanie w dół), chmura g-g okrążenia referencyjnego + kropka bieżąca
per okrążenie, odczyt wzdłużne/boczne/total g. `ax`/`ay` żyją w Storage (processed JSON),
nie w Postgresie.

> Uwaga: estymacja pozycji gazu/hamulca z przeciążeń (model mocy na kołach `P = v·a + K·v³`,
> korelujący przyspieszenie z prędkością wg diagramu g-g-v) pozostaje w kodzie
> (`buildLongModel`/`pedalAt` w `analysis.ts`, z testami), ale nie jest teraz głównym widokiem.

### Sektory i zakręty

Auto-detekcja zakrętów z bocznego przeciążenia `|ay|` (histereza + min. długość, apex = min.
prędkość). Podział na sektory (S1–S3) i zakręty (T1…Tn) z analizą per segment: czas, delta
względem okrążenia referencyjnego, min. prędkość. Klik segmentu → mapa przybliża do niego,
wykres prędkości podświetla zakres; „Cały tor" resetuje. Tryb koloru „wg sektorów" maluje
obrys toru jak w RS3.
