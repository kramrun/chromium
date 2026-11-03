'use strict';
(() => {
  const defaults = {
    frame: '#2e273b', toolbar: '#393344', tab_text: '#f5f1fa',
    toolbar_button_icon: '#e2dcec', ntp_background: '#211e28', ntp_text: '#f5f1fa',
  };
  const labels = {
    frame: ['Панель вкладок', 'Фон за вкладками'],
    toolbar: ['Панель инструментов', 'Активная вкладка и кнопки'],
    tab_text: ['Текст вкладки', 'Название активной вкладки'],
    toolbar_button_icon: ['Значки', 'Кнопки панели инструментов'],
    ntp_background: ['Новая вкладка', 'Цвет фона страницы'],
    ntp_text: ['Текст новой вкладки', 'Заголовки и подписи'],
  };
  const properties = {frame: '--frame', toolbar: '--toolbar', tab_text: '--tab-text', toolbar_button_icon: '--icon', ntp_background: '--ntp', ntp_text: '--ntp-text'};
  const $ = id => document.getElementById(id);
  const colorInputs = {};
  const values = {...defaults};
  const status = $('status');
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  function ratio(first, second) {
    const luminance = hex => rgb(hex).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((a, n, i) => a + n * [.2126, .7152, .0722][i], 0);
    const [a, b] = [luminance(first), luminance(second)].sort((x, y) => y - x);
    return (a + .05) / (b + .05);
  }
  function render() {
    for (const [key, value] of Object.entries(values)) {
      $('browser-preview').style.setProperty(properties[key], value);
      colorInputs[key].input.value = value;
      colorInputs[key].hex.textContent = value.toUpperCase();
    }
    const lowContrast = ratio(values.tab_text, values.toolbar) < 4.5 || ratio(values.ntp_text, values.ntp_background) < 4.5;
    $('contrast').classList.toggle('warning', lowContrast);
    $('contrast').textContent = lowContrast ? 'Некоторый текст может быть плохо виден: увеличьте разницу между цветом текста и фона.' : 'Контраст текста в примере достаточный. Проверьте результат и в самом браузере.';
  }
  for (const [key, [label, detail]] of Object.entries(labels)) {
    const row = document.createElement('label'); row.className = 'color-row';
    const title = document.createElement('span'); title.className = 'color-label'; title.textContent = label;
    const hint = document.createElement('small'); hint.textContent = detail; title.append(hint);
    const right = document.createElement('span'); right.className = 'color-value';
    const hex = document.createElement('span');
    const input = document.createElement('input'); input.type = 'color'; input.setAttribute('aria-label', label);
    input.addEventListener('input', () => { values[key] = input.value; render(); });
    right.append(hex, input); row.append(title, right); $('color-list').append(row);
    colorInputs[key] = {input, hex};
  }
  $('reset').addEventListener('click', () => { Object.assign(values, defaults); $('theme-name').value = 'Quiet Violet'; status.textContent = ''; render(); });
  $('export').addEventListener('click', () => {
    const name = $('theme-name').value.trim();
    if (!name) { status.textContent = 'Введите название темы.'; $('theme-name').focus(); return; }
    const manifest = {manifest_version: 3, name, version: '1.0.0', theme: {colors: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, rgb(v)]))}};
    const url = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2) + '\n'], {type:'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = 'manifest.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = 'Файл готов. Поместите его в отдельную папку и установите тему по инструкции.';
  });
  $('import').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error('Файл слишком большой.');
      const data = JSON.parse(await file.text());
      if (!data || typeof data !== 'object' || !data.theme || typeof data.theme.colors !== 'object' || data.theme.colors === null) throw new Error('В файле нет цветов темы Chromium.');
      const next = {...defaults};
      for (const key of Object.keys(defaults)) {
        const color = data.theme.colors[key];
        if (color === undefined) continue;
        if (!Array.isArray(color) || color.length !== 3 || !color.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) throw new Error(`Неверный цвет: ${key}.`);
        next[key] = '#' + color.map(n => n.toString(16).padStart(2, '0')).join('');
      }
      Object.assign(values, next); $('theme-name').value = typeof data.name === 'string' ? data.name.slice(0, 45) : 'Моя тема'; render();
      status.textContent = 'Цвета загружены. Изображения и другие свойства темы не импортируются.';
    } catch (error) { status.textContent = `Не удалось открыть тему: ${error.message}`; }
    event.target.value = '';
  });
  render();
})();
