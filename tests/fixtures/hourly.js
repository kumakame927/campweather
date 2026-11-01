import { hourTimes } from '../../src/hourly.js';
export function hourlyPayload(trip) {
  const time = hourTimes(trip.dates), temperature = time.map(() => 12);
  for (let hour = 12; hour <= 16; hour++) temperature[hour] = [18, 19, 20, 19, 18][hour - 12];
  if (trip.nights) {
    for (let index = 18; index <= 33; index++) temperature[index] = 8;
    temperature[23] = 7; temperature[24] = 6; temperature[33] = 5;
    temperature[47] = 17;
  }
  return {
    timezone: 'Asia/Tokyo', utc_offset_seconds: 32400,
    daily_units: { temperature_2m_max: '°C', temperature_2m_min: '°C', wind_speed_10m_max: 'm/s', precipitation_probability_max: '%' },
    daily: { time: trip.dates, temperature_2m_max: trip.dates.map(() => 20), temperature_2m_min: trip.dates.map(() => 5), wind_speed_10m_max: trip.dates.map(() => 3), precipitation_probability_max: trip.dates.map(() => 20), weather_code: trip.dates.map(() => 2) },
    hourly_units: { time: 'iso8601', temperature_2m: '°C', apparent_temperature: '°C', precipitation_probability: '%', wind_speed_10m: 'm/s', relative_humidity_2m: '%', weather_code: 'wmo code' },
    hourly: { time, temperature_2m: temperature, apparent_temperature: temperature.map(value => value - 3), precipitation_probability: time.map(() => 20), wind_speed_10m: time.map(() => 3), relative_humidity_2m: time.map(() => 70), weather_code: time.map(() => 2) },
  };
}
