import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable, map } from "rxjs";
import { z } from "zod";
import { ZodSerializationError, ZodValidationError } from "./zod.errors";
import { zodValidate } from "./zod.validate";

/** Metadata key used to attach a Zod schema to a route handler via {@link ZodSerializer}. */
export const ZOD_SERIALIZER_KEY = Symbol("ZOD_SERIALIZER");

/**
 * Intercepts handler responses and validates them through the schema attached via {@link ZodSerializer}.
 * Throws {@link ZodSerializationError} if the response does not match the schema.
 */
@Injectable()
export class ZodSerializerInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const schema = this.reflector.get<z.ZodType>(
      ZOD_SERIALIZER_KEY,
      context.getHandler(),
    );

    if (!schema) return next.handle();

    return next.handle().pipe(
      map((data) => {
        try {
          return zodValidate(schema, data);
        } catch (e) {
          if (e instanceof ZodValidationError) {
            throw new ZodSerializationError(e);
          }
          throw e;
        }
      }),
    );
  }
}

/** Attach a Zod schema to a handler to serialize its response through it. */
export const ZodSerializer = (schema: z.ZodType) =>
  SetMetadata(ZOD_SERIALIZER_KEY, schema);
