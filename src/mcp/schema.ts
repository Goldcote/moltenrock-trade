// Minimal JSON-Schema subset validator for tool arguments (object/string/integer/number/boolean/array,
// required, enum, minimum/maximum, maxLength, maxItems, nullable via type arrays). Enough to give agents
// precise, machine-readable errors without a dependency.

export type JsonSchema = {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  enum?: unknown[];
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  minLength?: number;
  maxItems?: number;
  minItems?: number;
};

const typeOf = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);

export function validateArgs(schema: JsonSchema, value: unknown, path = 'arguments'): string[] {
  const errors: string[] = [];
  const types = schema.type ? (Array.isArray(schema.type) ? schema.type : [schema.type]) : null;
  if (types) {
    const t = typeOf(value);
    const ok = types.some((want) => want === t || (want === 'number' && t === 'integer'));
    if (!ok) return [`${path} must be ${types.join(' or ')}`];
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} must be ≥ ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} must be ≤ ${schema.maximum}`);
  }
  if (typeof value === 'string') {
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path} must be at most ${schema.maxLength} characters`);
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path} must be at least ${schema.minLength} characters`);
  }
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path} may have at most ${schema.maxItems} items`);
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path} needs at least ${schema.minItems} items`);
    if (schema.items) value.forEach((v, i) => errors.push(...validateArgs(schema.items as JsonSchema, v, `${path}[${i}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value) && schema.properties) {
    const obj = value as Record<string, unknown>;
    for (const r of schema.required ?? []) if (obj[r] === undefined) errors.push(`${path}.${r} is required`);
    for (const [k, v] of Object.entries(obj)) {
      const sub = schema.properties[k];
      if (!sub) { if (schema.additionalProperties === false) errors.push(`${path}.${k} is not a known argument`); continue; }
      if (v !== undefined) errors.push(...validateArgs(sub, v, `${path}.${k}`));
    }
  }
  return errors;
}
