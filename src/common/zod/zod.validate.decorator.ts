import { z } from "zod";
import { zodValidate } from "./zod.validate";

const ZOD_VALIDATIONS_KEY = Symbol("ZOD_VALIDATIONS");
const ZOD_PATCHED_KEY = Symbol("ZOD_PATCHED");

interface ZodValidation {
  paramIndex: number;
  schema: z.ZodType;
}

/**
 * Parameter decorator. Validates the decorated parameter against `schema`
 * before the method body runs. Throws {@link ZodValidationError} on failure.
 *
 * @example
 * async create(@ZodValidate(UserSchema) data: z.infer<typeof UserSchema>)
 */
export function ZodValidate<S extends z.ZodType>(schema: S) {
  return function (
    target: object,
    propertyKey: string | symbol,
    paramIndex: number,
  ) {
    // Accumulate all @ZodValidate schemas for this method across multiple decorated params.
    const validations: ZodValidation[] =
      Reflect.getMetadata(ZOD_VALIDATIONS_KEY, target, propertyKey) ?? [];
    validations.push({ paramIndex, schema });
    Reflect.defineMetadata(
      ZOD_VALIDATIONS_KEY,
      validations,
      target,
      propertyKey,
    );

    // Patch the method only once — subsequent @ZodValidate on the same method just push to validations above.
    if (Reflect.getMetadata(ZOD_PATCHED_KEY, target, propertyKey)) return;
    Reflect.defineMetadata(ZOD_PATCHED_KEY, true, target, propertyKey);

    // Wrap the original method, preserving its reference for the apply call below.
    const proto = target as Record<string | symbol, unknown>;
    const original = proto[propertyKey] as (...args: unknown[]) => unknown;

    // Re-read validations at call time so all decorated params are visible regardless of decorator order.
    proto[propertyKey] = function (...args: unknown[]) {
      const all: ZodValidation[] =
        Reflect.getMetadata(ZOD_VALIDATIONS_KEY, target, propertyKey) ?? [];
      for (const { paramIndex, schema } of all) {
        args[paramIndex] = zodValidate(schema, args[paramIndex]);
      }
      return original.apply(this, args);
    };
  };
}
