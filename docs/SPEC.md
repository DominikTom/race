# Race Telemetry Analyzer — SPEC

Aplikacja webowa do analizy telemetrii wyścigowej z loggera **AiM Solo 2 DL**.

## Stack

- **Vite + React + TypeScript**
- **MapLibre GL JS** (mapa satelitarna)
- **Supabase** (Storage + Postgres + Auth)
- **Hosting: Vercel**
- Analiza po stronie przeglądarki, bez własnego backendu (dostęp do Supabase przez
  `@supabase/supabase-js` z RLS).

## ZASADA NADRZĘDNA

Surowa telemetria **NIGDY** nie trafia do Postgresa jako wiersze (34 660 próbek × 22 kanały
na sesję). Postgres = tylko indeks i podsumowania. Pliki + przesamplowane dane = Supabase
Storage. Analiza = przeglądarka.

## FORMAT DANYCH (z realnego eksportu RS3)

CSV, CRLF, separator przecinek, kropka dziesiętna, pola w cudzysłowach, nagłówki po angielsku.

Blok metadanych na górze (pary klucz–wartość): `Format`, `Session`, `Vehicle`, `Racer`,
`Championship`, `Date`, `Time`, `"Sample Rate"` (Hz, tu 20), `Duration`, `Segment`,
`"Beacon Markers"` (czasy [s] przecięć start/mety), `"Segment Times"` (czasy okrążeń).
Potem pusty wiersz, wiersz nazw kanałów, wiersz jednostek, pusty wiersz, dane.

### Kanały (22, w tej kolejności)

```
Time[s], GPS Speed[km/h], GPS Nsat, GPS LatAcc[g], GPS LonAcc[g], GPS Slope[deg],
GPS Heading[deg], GPS Gyro[deg/s], GPS Altitude[m], GPS PosAccuracy[mm],
GPS SpdAccuracy[km/h], GPS Radius[m], GPS Latitude[deg], GPS Longitude[deg],
Internal Battery[V], InlineAcc[g], LateralAcc[g], PitchRate[deg/s],
GPS LateralAcc[g], GPS InlineAcc[g], GPS Yaw Rate[deg/s], SPEED[km/h]
```

### Reguły parsera (TOLERANCYJNE, format ma warianty)

- Buduj mapę **nazwa→index** z wiersza nagłówków; nie zakładaj stałych pozycji kolumn.
- Wiersz nagłówków = pierwszy po metadanych z pierwszą komórką `Time` i zawierający
  `GPS Latitude` / `GPS Speed`. Następny niepusty wiersz = jednostki. Dane po nim.
- Częstotliwość czytaj z `Sample Rate` i/lub różnicy czasu (0.05 s = 20 Hz). Nie hardcode'uj.
- Podział na okrążenia z `Beacon Markers`: okrążenie `i` = próbki między `beacon[i]` a
  `beacon[i+1]`; etykieta z `Segment Times`; najniższy czas = best.
- Martwe kanały wykrywaj automatycznie (policz kolumny ~zero i ukryj). W tym pliku zerowe:
  `SPEED`, `GPS LateralAcc`, `GPS InlineAcc`, `GPS Yaw Rate`. Duplikat nazw: używaj
  `GPS LatAcc` (ma dane), nie `GPS LateralAcc` (zera).
- Guard: jeśli brak `GPS Latitude`/`Longitude`/`Speed` → komunikat
  **„Wyeksportuj z RS3 po angielsku”** zamiast cichego crasha.
- `GPS PosAccuracy` jest źle wyskalowany (mm, wartości 7–12) — nie używaj jako miary jakości.

## MODEL DANYCH

- Per okrążenie: dystans skumulowany między próbkami (haversine, metry) → `nd[] = cum/total (0..1)`.
- `sampleAt(lap, f)`: interpolacja `{lat, lon, v, t}` w ułamku dystansu `f` (binary search po `nd`).
- Delta: `delta(f) = sampleAt(B,f).t − sampleAt(A,f).t` (dodatnia = B wolniejsze = tracisz).
- Synchronizacja kursora między okrążeniami i delta **ZAWSZE po dystansie, nigdy po czasie**.

## SUPABASE

Storage buckety (prywatne):
- `raw` — oryginały `.csv`/`.xrk`, ścieżka `{user_id}/{session_id}.csv`
- `processed` — kompakt JSON per sesja: per okrążenie `{nd[],lat[],lon[],v[],t[]}`, ~1500 pkt.

Migracja SQL — patrz `supabase/migrations/0001_init.sql`.

Auth: Supabase email / magic-link.

## FUNKCJE P0

1. Wczytanie CSV (drag/drop + picker) → parse → okrążenia z beacon markers.
2. Mapa satelitarna MapLibre + linia GPS wybranych okrążeń + kursor pozycji na torze.
3. Wybór min. 2 okrążeń jednocześnie.
4. Suwak + Play; kursor synced po dystansie; pozycja rusza się dla każdego okrążenia.
5. Odczyt prędkości dla KAŻDEGO pokazanego okrążenia (nie tylko pierwszego).
6. Tryb koloru linii: po prędkości (heatmapa) / po okrążeniu (best=`#37d67a`, drugie=`#4aa3ff`).
7. Delta-time po dystansie (B−A), kolor: tracisz=czerwony, zyskujesz=zielony.
8. Wykres prędkość vs dystans dla wszystkich pokazanych okrążeń + pionowy kursor.
9. Ręczny offset satelity (suwaki dLat/dLon, zapis per tor) — koryguje przesunięcie zdjęcia
   względem GPS. Offset dodawaj do współrzędnych GPS, nie ruszaj kafelków.
10. Przycisk „Cały tor / Fit” (fitBounds do bbox okrążenia).

## MAPA (MapLibre)

Źródło satelity bez klucza API (Esri World Imagery), kolejność kafelków `{z}/{y}/{x}`:

```
https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}
```

Linia GPS = GeoJSON LineString `[lon,lat]`. Heatmapa prędkości = `line-gradient`
(`lineMetrics:true`) albo segmenty per-kolor. Kursor = GeoJSON Point / Marker aktualizowany na scrub.

## KRYTERIA AKCEPTACJI (na `sample/4.csv`)

- Wykrywa 20 Hz; best lap = **1:58.214 (lap 12)**; okrążenia dzielone z beacon markers.
- Mapa pokazuje CAŁY obrys Toru Poznań (nie fragment); linia leży na asfalcie po offsecie.
- Suwak na 50% dystansu → kropki obu okrążeń w ~tym samym punkcie toru.
- Delta na 100% dystansu ≈ **+1.525 s** (L13 1:59.739 − L12 1:58.214).
- Prędkość obu okrążeń widoczna jednocześnie (max w best ≈ **174 km/h**).
- Martwe kanały (`SPEED`, `GPS LateralAcc`/`InlineAcc`/`Yaw Rate`) automatycznie ukryte.

## KOLEJNOŚĆ BUDOWY

1. Repo + szkielet Vite+React+TS + deploy na Vercel (pusty ma działać live).
2. Supabase: migracja SQL + buckety `raw`/`processed` + Auth/RLS.
3. **KAMIEŃ MILOWY #1**: pipeline end-to-end na `sample/4.csv` — upload → parse → Storage →
   insert do bazy → lista sesji → otwarcie → jedno okrążenie na mapie satelitarnej.
   Wypisz w konsoli: liczba okrążeń, best lap, delta na 100%. Przejdź kryteria akceptacji
   zanim ruszysz dalej.
4. Dopiero potem funkcje P0 (2–10).

NIE buduj wszystkich funkcji naraz. Najpierw jedna sesja przechodzi całą drogę na `4.csv`.
