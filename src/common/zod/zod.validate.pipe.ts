import { Body, Param, Query, PipeTransform } from "@nestjs/common";
import { ZodObject, ZodRawShape } from "zod";
import { zodValidate } from "./zod.validate";

class ZodPipe<TSchema extends ZodObject<ZodRawShape>> implements PipeTransform {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown) {
    return zodValidate(this.schema, value);
  }
}

/** Drop-in for `@Body()` that validates and types the request body via a Zod schema. */
export const ZodBody = <TSchema extends ZodObject<ZodRawShape>>(
  schema: TSchema,
) => Body(new ZodPipe(schema));

/** Drop-in for `@Query()` that validates and types query parameters via a Zod schema. */
export const ZodQuery = <TSchema extends ZodObject<ZodRawShape>>(
  schema: TSchema,
) => Query(new ZodPipe(schema));

/** Drop-in for `@Param()` that validates and types route parameters via a Zod schema. */
export const ZodParam = <TSchema extends ZodObject<ZodRawShape>>(
  schema: TSchema,
) => Param(new ZodPipe(schema));
