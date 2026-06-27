import { ApiBody, ApiResponse } from "@nestjs/swagger";
import { z } from "zod";

const toOpenApi = (schema: z.ZodType): object => {
  const { $schema, ...rest } = z.toJSONSchema(schema) as Record<
    string,
    unknown
  >;
  return rest;
};

/** Drop-in for `@ApiBody()` that derives the OpenAPI schema from a Zod type. */
export const ZodApiBody = (schema: z.ZodType) =>
  ApiBody({ schema: toOpenApi(schema) });

/** Drop-in for `@ApiResponse()` that derives the OpenAPI schema from a Zod type. */
export const ZodApiResponse = (status: number, schema: z.ZodType) =>
  ApiResponse({ status, schema: toOpenApi(schema) });
