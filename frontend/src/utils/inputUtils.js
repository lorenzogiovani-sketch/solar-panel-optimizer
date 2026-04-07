/**
 * Helpers per il parsing di input numerici nei form React.
 * Preservano la stringa vuota (o parziale come '-' e '.') invece di convertirla a 0,
 * consentendo all'utente di svuotare il campo e digitare un nuovo valore.
 */

/**
 * Parse di un valore input numerico (float).
 * Ritorna il numero parsato se valido, oppure la stringa grezza se è '' / '-' / '.'.
 */
export function parseNumericInput(value) {
  if (value === '' || value === '-' || value === '.') return value;
  const num = parseFloat(value);
  return isNaN(num) ? '' : num;
}

/**
 * Parse di un valore input numerico (intero).
 * Ritorna il numero parsato se valido, oppure la stringa grezza se è '' / '-'.
 */
export function parseIntInput(value) {
  if (value === '' || value === '-') return value;
  const num = parseInt(value, 10);
  return isNaN(num) ? '' : num;
}
