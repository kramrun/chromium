// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// Network access is confined to this unprivileged frame. The privileged NTP
// never receives arbitrary response text or executes code from this frame.
export {};

async function loadWeather() {
  const params = new URLSearchParams(location.hash.slice(1));
  const city = (params.get('city') || '').trim().slice(0, 100);
  const id = params.get('id');
  if (!city || !id || !/^[a-z\d-]{1,80}$/i.test(id) || parent === window) {
    return;
  }
  const reply = (data: object) => parent.postMessage(
      {type: 'optimium-weather', id, city, ...data}, 'chrome://new-tab-page');
  const options: RequestInit = {
    signal: AbortSignal.timeout(12000),
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  };
  try {
    const geoResponse = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ru&format=json`, options);
    if (!geoResponse.ok) { throw new Error('Сервис поиска города недоступен.'); }
    const geo = await geoResponse.json() as {
      results?: Array<{latitude: number; longitude: number; name: string}>,
    };
    const place = geo.results?.[0];
    if (!place || !Number.isFinite(place.latitude) ||
        !Number.isFinite(place.longitude) || typeof place.name !== 'string') {
      throw new Error('Город не найден. Уточни название.');
    }
    const response = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,weather_code&timezone=auto`, options);
    if (!response.ok) { throw new Error('Погода временно недоступна.'); }
    const data = await response.json() as {
      current?: {temperature_2m: number; weather_code: number},
    };
    if (!Number.isFinite(data.current?.temperature_2m) ||
        !Number.isFinite(data.current?.weather_code)) {
      throw new Error('Нет данных о текущей погоде.');
    }
    reply({weather: {
      label: place.name.slice(0, 100),
      temperature: data.current!.temperature_2m,
      code: data.current!.weather_code,
    }});
  } catch (error) {
    reply({error: error instanceof Error && error.name !== 'TimeoutError' ?
      error.message.slice(0, 180) : 'Погода не загрузилась. Повтори позже.'});
  }
}

void loadWeather();
