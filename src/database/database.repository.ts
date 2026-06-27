import {
  Collection,
  CountDocumentsOptions,
  DeleteOptions,
  DeleteResult,
  Document,
  Filter,
  FindOneAndUpdateOptions,
  FindOptions,
  ObjectId,
  UpdateOptions,
  UpdateResult,
} from "mongodb";
import { z, ZodObject, ZodRawShape } from "zod";
import { zodValidate } from "../common/zod/zod.validate";

import { InvalidIdError, NotFoundError } from "./database.errors";

/**
 * Generic MongoDB repository that wraps native driver operations with Zod validation.
 * The caller owns the full document shape — _id, createdAt, updatedAt are caller-provided.
 * Only inclusion projections are supported ({ field: 1 }).
 */
export class BaseRepository<TSchema extends ZodObject<ZodRawShape>> {
  /** Deep-partial schema for updateOne — every field optional at every nesting level. */
  private readonly partialSchema: z.ZodTypeAny;
  /** Pre-computed mask derived from schema shape, used when no projection is given. */
  private readonly schemaMask: Record<string, unknown>;

  constructor(
    readonly collection: Collection,
    protected readonly schema: TSchema,
  ) {
    this.partialSchema = this.toDeepPartial(schema);
    this.schemaMask = this.schemaToMask(schema.shape);
  }

  /** Validates and inserts a document. Caller provides all fields including _id. */
  async insertOne(data: z.infer<TSchema>): Promise<void> {
    const validated = zodValidate(this.schema, data) as Record<string, unknown>;
    await this.collection.insertOne(validated);
  }

  /** Returns all documents matching filter, stripped to schema shape (or projected fields). */
  async find(
    filter: Filter<Document> = {},
    options?: FindOptions,
  ): Promise<z.infer<TSchema>[]> {
    const docs = await this.collection.find(filter, options).toArray();
    const mask = this.selectMask(options?.projection);
    return docs.map(
      (doc) =>
        this.applyMask(
          doc as Record<string, unknown>,
          mask,
        ) as z.infer<TSchema>,
    );
  }

  /** Returns first document matching filter. Throws {@link NotFoundError} if absent. */
  async findOne(
    filter: Filter<Document>,
    options?: FindOptions,
  ): Promise<z.infer<TSchema>> {
    const doc = await this.collection.findOne(filter, options);
    if (!doc) throw new NotFoundError();
    const mask = this.selectMask(options?.projection);
    return this.applyMask(
      doc as Record<string, unknown>,
      mask,
    ) as z.infer<TSchema>;
  }

  /**
   * Validates data as deep-partial and applies as $set.
   * Nested objects are flattened to dot notation to avoid overwriting sibling fields.
   */
  async updateOne(
    filter: Filter<Document>,
    data: Partial<z.infer<TSchema>>,
    options?: UpdateOptions,
  ): Promise<UpdateResult> {
    const validated = zodValidate(this.partialSchema, data);
    return this.collection.updateOne(
      filter,
      { $set: this.toDotNotation(validated as Record<string, unknown>) },
      options,
    );
  }

  /** Atomically updates and returns the updated document. Throws {@link NotFoundError} if absent. */
  async findOneAndUpdate(
    filter: Filter<Document>,
    data: Partial<z.infer<TSchema>>,
    options?: FindOneAndUpdateOptions,
  ): Promise<z.infer<TSchema>> {
    const validated = zodValidate(this.partialSchema, data);
    const doc = await this.collection.findOneAndUpdate(
      filter,
      { $set: this.toDotNotation(validated as Record<string, unknown>) },
      { returnDocument: "after", ...options },
    );
    if (!doc) throw new NotFoundError();
    const mask = this.selectMask(
      (options as FindOptions | undefined)?.projection,
    );
    return this.applyMask(
      doc as Record<string, unknown>,
      mask,
    ) as z.infer<TSchema>;
  }

  /** Deletes documents matching filter. Caller checks deletedCount on the returned result. */
  async deleteOne(
    filter: Filter<Document>,
    options?: DeleteOptions,
  ): Promise<DeleteResult> {
    return this.collection.deleteOne(filter, options);
  }

  /** Returns the number of documents matching filter. */
  async countDocuments(
    filter: Filter<Document> = {},
    options?: CountDocumentsOptions,
  ): Promise<number> {
    return this.collection.countDocuments(filter, options);
  }

  /** Parses a string id into ObjectId. Throws {@link InvalidIdError} if not a valid ObjectId. */
  parseId(id: string): ObjectId {
    if (id.length !== 24 || !ObjectId.isValid(id)) throw new InvalidIdError(id);
    return new ObjectId(id);
  }

  /** Recursively wraps every field in z.optional(), including nested ZodObject shapes. */
  private toDeepPartial(schema: ZodObject<ZodRawShape>): z.ZodTypeAny {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [key, field] of Object.entries(schema.shape)) {
      const base =
        field instanceof ZodObject
          ? this.toDeepPartial(field as ZodObject<ZodRawShape>)
          : (field as z.ZodTypeAny);
      shape[key] = z.optional(base);
    }
    return z.object(shape);
  }

  /** Converts a ZodObject shape to a plain nested mask where leaf values are 1. */
  private schemaToMask(shape: ZodRawShape): Record<string, unknown> {
    const mask: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(shape)) {
      mask[key] =
        field instanceof ZodObject
          ? this.schemaToMask((field as ZodObject<ZodRawShape>).shape)
          : 1;
    }
    return mask;
  }

  /** Returns the mask for document coercion. No projection → full schema mask. */
  private selectMask(projection?: Document): Record<string, unknown> {
    return projection
      ? this.pruneToSchema(this.projectionToMask(projection), this.schemaMask)
      : this.schemaMask;
  }

  /**
   * Converts a dot-notation inclusion projection to a nested mask.
   * { "address.city": 1, "name": 1 } → { address: { city: 1 }, name: 1 }
   */
  private projectionToMask(projection: Document): Record<string, unknown> {
    const mask: Record<string, unknown> = {};
    for (const key of Object.keys(projection)) {
      const parts = key.split(".");
      let node = mask;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!this.isPlainObject(node[parts[i]])) node[parts[i]] = {};
        node = node[parts[i]] as Record<string, unknown>;
      }
      node[parts[parts.length - 1]] = 1;
    }
    return mask;
  }

  /** Recursively removes from mask any key not present in schema. */
  private pruneToSchema(
    mask: Record<string, unknown>,
    schema: Record<string, unknown>,
  ): Record<string, unknown> {
    for (const key of Object.keys(mask)) {
      if (!(key in schema)) {
        delete mask[key];
        continue;
      }
      const mVal = mask[key];
      const sVal = schema[key];
      if (this.isPlainObject(mVal) && this.isPlainObject(sVal)) {
        mask[key] = this.pruneToSchema(
          mVal as Record<string, unknown>,
          sVal as Record<string, unknown>,
        );
        // drop parent key if all nested fields were pruned (e.g. projection requested a non-schema nested path)
        if (Object.keys(mask[key] as Record<string, unknown>).length === 0) {
          delete mask[key];
        }
      }
    }
    return mask;
  }

  /**
   * Recursively picks only keys present in mask from raw.
   * Sub-object mask values trigger recursion; scalar values (1) act as leaf selectors.
   */
  private applyMask(
    raw: Record<string, unknown>,
    mask: Record<string, unknown>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(mask)) {
      const value = raw[key];
      const maskValue = mask[key];
      if (this.isPlainObject(maskValue) && this.isPlainObject(value)) {
        result[key] = this.applyMask(
          value as Record<string, unknown>,
          maskValue as Record<string, unknown>,
        );
        continue;
      }
      result[key] = value;
    }
    return result;
  }

  /**
   * Flattens a nested object to dot-notation keys for MongoDB $set.
   * Prevents $set from overwriting sibling fields. Leaves Date, ObjectId, Array intact.
   */
  private toDotNotation(
    obj: Record<string, unknown>,
    prefix = "",
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (this.isPlainObject(value)) {
        const nested = this.toDotNotation(
          value as Record<string, unknown>,
          fullKey,
        );
        for (const [k, v] of Object.entries(nested)) {
          result[k] = v;
        }
        continue;
      }
      result[fullKey] = value;
    }
    return result;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype
    );
  }
}
