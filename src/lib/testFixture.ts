// Generator syntetycznego CSV w formacie AiM Solo 2 DL — do testów bez realnego pliku.
// NIE zastępuje sample/4.csv (fixture akceptacyjny); służy tylko testom jednostkowym.

const CHANNELS = [
  'Time',
  'GPS Speed',
  'GPS Nsat',
  'GPS LatAcc',
  'GPS LonAcc',
  'GPS Slope',
  'GPS Heading',
  'GPS Gyro',
  'GPS Altitude',
  'GPS PosAccuracy',
  'GPS SpdAccuracy',
  'GPS Radius',
  'GPS Latitude',
  'GPS Longitude',
  'Internal Battery',
  'InlineAcc',
  'LateralAcc',
  'PitchRate',
  'GPS LateralAcc', // martwy (duplikat nazwy, zera)
  'GPS InlineAcc', // martwy
  'GPS Yaw Rate', // martwy
  'SPEED', // martwy
]
const UNITS = [
  '[s]', '[km/h]', '', '[g]', '[g]', '[deg]', '[deg]', '[deg/s]', '[m]', '[mm]',
  '[km/h]', '[m]', '[deg]', '[deg]', '[V]', '[g]', '[g]', '[deg/s]', '[g]', '[g]', '[deg/s]', '[km/h]',
]

const DEAD = new Set(['GPS LateralAcc', 'GPS InlineAcc', 'GPS Yaw Rate', 'SPEED'])

function q(v: string | number): string {
  return `"${v}"`
}

interface FixtureOpts {
  hz?: number
  /** czasy okrążeń [s] w kolejności */
  lapTimes: number[]
  /** liczba próbek na okrążenie (stała dla prostoty) */
  perLap?: number
}

/**
 * Buduje CSV z prostym owalem. Każde okrążenie to ta sama pętla geograficzna,
 * ale rozciągnięta w czasie wg lapTimes -> różne prędkości, znany best i delta.
 */
export function makeFixtureCsv(opts: FixtureOpts): string {
  const hz = opts.hz ?? 20
  const perLap = opts.perLap ?? 400
  const lat0 = 52.4237
  const lon0 = 16.8213
  const rLat = 0.006
  const rLon = 0.009

  const beacons: number[] = []
  const rows: string[] = []
  let tAbs = 5.0 // out-lap offset
  beacons.push(tAbs)

  for (let lap = 0; lap < opts.lapTimes.length; lap++) {
    const lapTime = opts.lapTimes[lap]
    const dt = lapTime / perLap
    for (let i = 0; i < perLap; i++) {
      const frac = i / perLap
      const ang = frac * 2 * Math.PI
      const lat = lat0 + rLat * Math.sin(ang)
      const lon = lon0 + rLon * Math.cos(ang)
      // prędkość ~ odwrotność lapTime (szybsze okrążenie = większa prędkość)
      const v = 120 * (118.214 / lapTime) * (1 + 0.4 * Math.abs(Math.sin(ang)))
      const cells = CHANNELS.map((name) => {
        switch (name) {
          case 'Time': return tAbs.toFixed(3)
          case 'GPS Speed': return v.toFixed(2)
          case 'GPS Latitude': return lat.toFixed(7)
          case 'GPS Longitude': return lon.toFixed(7)
          case 'GPS Nsat': return '12'
          case 'GPS Altitude': return '90'
          case 'GPS PosAccuracy': return '9'
          case 'Internal Battery': return '4.1'
          default:
            return DEAD.has(name) ? '0.0' : (0.01 * Math.sin(ang)).toFixed(3)
        }
      })
      rows.push(cells.map(q).join(','))
      tAbs += dt === 0 ? 1 / hz : dt
    }
    beacons.push(tAbs)
  }

  const meta: string[] = [
    [q('Format'), q('AiM CSV File')].join(','),
    [q('Session'), q('Test')].join(','),
    [q('Vehicle'), q('Kart')].join(','),
    [q('Racer'), q('Tester')].join(','),
    [q('Championship'), q('')].join(','),
    [q('Date'), q('01/07/2026')].join(','),
    [q('Time'), q('12:00:00')].join(','),
    [q('Sample Rate'), q(String(hz))].join(','),
    [q('Duration'), q(tAbs.toFixed(3))].join(','),
    [q('Segment'), q('1')].join(','),
    [q('Beacon Markers'), ...beacons.map((b) => q(b.toFixed(3)))].join(','),
    [q('Segment Times'), ...opts.lapTimes.map((t) => q(t.toFixed(3)))].join(','),
  ]

  const header = CHANNELS.map(q).join(',')
  const units = UNITS.map(q).join(',')

  return [...meta, '', header, units, '', ...rows].join('\r\n')
}
