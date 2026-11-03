'use strict';
// User CSS is arbitrary styling, not JavaScript. It may itself load resources.
function validateUserCss(css) {
  if (typeof css !== 'string' || !css.trim() || css.length > 12000) throw new Error('Введите CSS длиной до 12000 символов.');
  return css;
}
