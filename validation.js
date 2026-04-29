// validation.js — Utilidades de validación de formularios
// Uso: import { validate, rules } from "./validation.js";

/* ── Reglas individuales ─────────────────────────────────────── */

export const rules = {
  required: (msg = "Este campo es obligatorio") =>
    (val) => val.trim() ? null : msg,

  minLength: (min, msg) =>
    (val) => val.trim().length >= min ? null : (msg || `Mínimo ${min} caracteres`),

  maxLength: (max, msg) =>
    (val) => val.trim().length <= max ? null : (msg || `Máximo ${max} caracteres`),

  email: (msg = "Email inválido") =>
    (val) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim()) ? null : msg,

  phone: (msg = "Teléfono inválido (solo números, 8-15 dígitos)") =>
    (val) => {
      const digits = val.replace(/\D/g, "");
      return digits.length >= 8 && digits.length <= 15 ? null : msg;
    },

  numeric: (msg = "Solo números") =>
    (val) => /^\d+$/.test(val.trim()) ? null : msg,

  positiveInt: (msg = "Debe ser un número entero positivo") =>
    (val) => {
      const n = Number(val);
      return Number.isInteger(n) && n > 0 ? null : msg;
    },

  range: (min, max, msg) =>
    (val) => {
      const n = Number(val);
      return n >= min && n <= max ? null : (msg || `Debe estar entre ${min} y ${max}`);
    },

  noHtml: (msg = "No se permiten caracteres HTML") =>
    (val) => /<[^>]+>/.test(val) ? msg : null,

  date: (msg = "Fecha inválida (formato DD/MM/YYYY o YYYY-MM-DD)") =>
    (val) => {
      if (!val.trim()) return null; // permitir vacío — combinar con required si es necesario
      const iso = /^\d{4}-\d{2}-\d{2}$/.test(val.trim());
      const dmy = /^\d{2}\/\d{2}\/\d{4}$/.test(val.trim());
      if (!iso && !dmy) return msg;
      const d = new Date(iso ? val.trim() : val.trim().split("/").reverse().join("-"));
      return isNaN(d.getTime()) ? msg : null;
    },

  match: (otherVal, msg = "Los valores no coinciden") =>
    (val) => val === otherVal ? null : msg,
};

/* ── Función principal de validación ────────────────────────── */

/**
 * Valida un objeto de campos contra un esquema de reglas.
 *
 * @param {Object} fields   - { fieldName: valor }
 * @param {Object} schema   - { fieldName: [rule1, rule2, ...] }
 * @returns {{ valid: boolean, errors: Object }}
 *
 * @example
 * const { valid, errors } = validate(
 *   { firstName: "  ", email: "notanemail" },
 *   {
 *     firstName: [rules.required("Nombre obligatorio")],
 *     email: [rules.required(), rules.email()]
 *   }
 * );
 */
export function validate(fields, schema) {
  const errors = {};
  for (const [key, fieldRules] of Object.entries(schema)) {
    const val = String(fields[key] ?? "");
    for (const rule of fieldRules) {
      const error = rule(val);
      if (error) {
        errors[key] = error;
        break;
      }
    }
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

/* ── Utilidades de UI ────────────────────────────────────────── */

/**
 * Muestra errores de validación en el DOM.
 * Busca elementos con id="${fieldName}-error" y los llena con el mensaje.
 * También marca los inputs con clase "input-error" si tienen el campo en error.
 *
 * @param {Object} errors - resultado de validate()
 * @param {Element} container - elemento contenedor (default: document)
 */
export function showErrors(errors, container = document) {
  // Limpiar errores previos
  container.querySelectorAll(".input-error").forEach(el => el.classList.remove("input-error"));
  container.querySelectorAll(".field-error").forEach(el => { el.textContent = ""; el.style.display = "none"; });

  for (const [key, msg] of Object.entries(errors)) {
    const input = container.querySelector(`#${key}, [name="${key}"]`);
    if (input) input.classList.add("input-error");

    const errorEl = container.querySelector(`#${key}-error, [data-error="${key}"]`);
    if (errorEl) {
      errorEl.textContent = msg;
      errorEl.style.display = "";
    }
  }
}

/**
 * Limpia todos los errores de validación en el contenedor.
 */
export function clearErrors(container = document) {
  container.querySelectorAll(".input-error").forEach(el => el.classList.remove("input-error"));
  container.querySelectorAll(".field-error").forEach(el => { el.textContent = ""; el.style.display = "none"; });
}

/* ── Validadores compuestos para entidades del dominio ───────── */

export function validateDriver(data) {
  return validate(data, {
    firstName: [rules.required("El nombre es obligatorio"), rules.noHtml()],
    lastName:  [rules.required("El apellido es obligatorio"), rules.noHtml()],
    email:     [rules.email()],
    phone:     [rules.phone()],
    capacity:  [rules.positiveInt("La capacidad debe ser un número entero mayor a 0"), rules.range(1, 20)],
  });
}

export function validatePassenger(data) {
  return validate(data, {
    firstName: [rules.required("El nombre es obligatorio"), rules.noHtml()],
    lastName:  [rules.required("El apellido es obligatorio"), rules.noHtml()],
    phone:     [rules.phone()],
  });
}

export function validateEvent(data) {
  return validate(data, {
    name: [rules.required("El nombre del evento es obligatorio"), rules.minLength(3)],
  });
}

export function validateInvite(data) {
  return validate(data, {
    email:     [rules.required("El email es obligatorio"), rules.email()],
    firstName: [rules.required("El nombre es obligatorio")],
    lastName:  [rules.required("El apellido es obligatorio")],
  });
}
