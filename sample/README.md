# sample/

Tu trafia **`4.csv`** — realny eksport z AiM RS3 (Tor Poznań), fixture kryteriów akceptacji:

- 20 Hz, best lap **1:58.214 (lap 12)**, okrążenia z beacon markers
- delta na 100% ≈ **+1.525 s** (L13 1:59.739 − L12 1:58.214)
- max prędkość w best ≈ **174 km/h**
- martwe kanały: `SPEED`, `GPS LateralAcc`, `GPS InlineAcc`, `GPS Yaw Rate`

Plik nie został dołączony do środowiska w tej sesji — wgraj go tutaj jako `sample/4.csv`.
Format i reguły parsera opisuje `docs/SPEC.md`. Testy jednostkowe działają na syntetycznym
fixture (`src/lib/testFixture.ts`) i nie wymagają tego pliku.
