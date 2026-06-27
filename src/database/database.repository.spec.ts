import { Collection, MongoClient, ObjectId } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { z } from "zod";
import { BaseRepository } from "./database.repository";
import { ZodValidationError } from "../common/zod/zod.errors";
import { InvalidIdError, NotFoundError } from "./database.errors";

// ─── Schema ───────────────────────────────────────────────────────────────────
// Intentionally includes a nested object (address) to exercise recursive helpers.

const AddressSchema = z.object({
  city: z.string(),
  zip: z.string(),
});

const TestSchema = z.object({
  _id: z.custom<ObjectId>((v) => v instanceof ObjectId),
  name: z.string(),
  age: z.number(),
  tags: z.array(z.string()),
  address: AddressSchema,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCollection(
  overrides: Partial<Record<string, unknown>> = {},
): Collection {
  return {
    insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    find: jest
      .fn()
      .mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    findOne: jest.fn().mockResolvedValue(null),
    updateOne: jest.fn().mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
      upsertedCount: 0,
    }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    countDocuments: jest.fn().mockResolvedValue(0),
    ...overrides,
  } as unknown as Collection;
}

function makeRepo(colOverrides: Partial<Record<string, unknown>> = {}) {
  const col = makeCollection(colOverrides);
  return { repo: new BaseRepository(col, TestSchema), col };
}

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    name: "Alice",
    age: 30,
    tags: ["a", "b"],
    address: { city: "NYC", zip: "10001" },
    ...overrides,
  };
}

// Helper to read the $set argument from a mocked updateOne call.
function getSetArg(col: Collection, callIndex = 0): Record<string, unknown> {
  return (
    col.updateOne as unknown as { mock: { calls: Record<string, unknown>[][] } }
  ).mock.calls[callIndex][1].$set as Record<string, unknown>;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("BaseRepository", () => {
  // ── validate ─────────────────────────────────────────────────────────────────
  // Covers: validate() called by insertOne and updateOne.
  // Asserts that Zod rejects bad data before it reaches the driver.

  describe("validate", () => {
    it("passes valid document straight to collection.insertOne", async () => {
      // Verifies the happy path — exact same object reaches the driver unchanged.
      const { repo, col } = makeRepo();
      const doc = makeDoc();
      await repo.insertOne(doc as z.infer<typeof TestSchema>);
      expect(col.insertOne).toHaveBeenCalledWith(doc);
    });

    it("throws ZodValidationError when a root field has the wrong type", async () => {
      // age must be number; passing a string triggers schema rejection.
      const { repo } = makeRepo();
      const doc = makeDoc({ age: "not-a-number" });
      await expect(
        repo.insertOne(doc as z.infer<typeof TestSchema>),
      ).rejects.toThrow(ZodValidationError);
    });

    it("throws ZodValidationError when a nested field has the wrong type", async () => {
      // Validates that nested ZodObject fields are also checked, not just root fields.
      const { repo } = makeRepo();
      const doc = makeDoc({ address: { city: 42, zip: "10001" } });
      await expect(
        repo.insertOne(doc as z.infer<typeof TestSchema>),
      ).rejects.toThrow(ZodValidationError);
    });

    it("throws ZodValidationError when a required root field is missing", async () => {
      // Missing required field should fail, not silently insert undefined.
      const { repo } = makeRepo();
      const { age: _age, ...doc } = makeDoc();
      await expect(
        repo.insertOne(doc as z.infer<typeof TestSchema>),
      ).rejects.toThrow(ZodValidationError);
    });

    it("throws ZodValidationError when a required nested field is missing", async () => {
      // Partial nested objects also fail full-document validation.
      const { repo } = makeRepo();
      const doc = makeDoc({ address: { city: "NYC" } }); // zip missing
      await expect(
        repo.insertOne(doc as z.infer<typeof TestSchema>),
      ).rejects.toThrow(ZodValidationError);
    });
  });

  // ── schemaToMask + applyMask (no projection) ──────────────────────────────
  // Covers: schemaToMask() builds the mask at construction time.
  //         applyMask() uses it to strip fields not in the schema.
  // MongoDB may return extra fields (e.g. __v, internal metadata); the repo
  // ensures returned documents only contain what the schema declares.

  describe("schemaToMask + applyMask (find without projection)", () => {
    it("strips extra root-level fields not in schema", async () => {
      // Raw doc has 'extra' — must not appear in returned value.
      const doc = makeDoc({ extra: "strip-me" });
      const { repo } = makeRepo({
        find: jest
          .fn()
          .mockReturnValue({ toArray: jest.fn().mockResolvedValue([doc]) }),
      });
      const [result] = await repo.find();
      expect(result).not.toHaveProperty("extra");
      expect(result).toHaveProperty("name", "Alice");
    });

    it("strips extra nested fields not in schema", async () => {
      // Nested doc has 'county' which is not in AddressSchema.
      const doc = makeDoc({
        address: { city: "NYC", zip: "10001", county: "strip-me" },
      });
      const { repo } = makeRepo({
        find: jest
          .fn()
          .mockReturnValue({ toArray: jest.fn().mockResolvedValue([doc]) }),
      });
      const [result] = await repo.find();
      expect(result.address).not.toHaveProperty("county");
      expect(result.address).toHaveProperty("city");
    });

    it("returns all schema fields when all are present", async () => {
      // Full schema doc — nothing stripped, everything returned.
      const doc = makeDoc();
      const { repo } = makeRepo({
        find: jest
          .fn()
          .mockReturnValue({ toArray: jest.fn().mockResolvedValue([doc]) }),
      });
      const [result] = await repo.find();
      expect(result).toHaveProperty("_id");
      expect(result).toHaveProperty("name");
      expect(result).toHaveProperty("age");
      expect(result).toHaveProperty("tags");
      expect(result).toHaveProperty("address");
      expect(result.address).toHaveProperty("city");
      expect(result.address).toHaveProperty("zip");
    });

    it("preserves array fields intact (not recursed into)", async () => {
      // Arrays are a leaf value — applyMask should not try to recurse into them.
      const doc = makeDoc({ tags: ["x", "y", "z"] });
      const { repo } = makeRepo({
        find: jest
          .fn()
          .mockReturnValue({ toArray: jest.fn().mockResolvedValue([doc]) }),
      });
      const [result] = await repo.find();
      expect(result.tags).toEqual(["x", "y", "z"]);
    });

    it("returns empty array when collection has no documents", async () => {
      // find() must propagate empty results without errors.
      const { repo } = makeRepo({
        find: jest
          .fn()
          .mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
      });
      const results = await repo.find();
      expect(results).toEqual([]);
    });

    it("passes filter and options to the driver", async () => {
      // Repo must forward the caller's filter and options unchanged.
      const { repo, col } = makeRepo();
      const filter = { name: "Alice" };
      const options = { limit: 5 };
      await repo.find(filter, options);
      expect(col.find).toHaveBeenCalledWith(filter, options);
    });
  });

  // ── projectionToMask + applyMask (inclusion projection) ──────────────────
  // Covers: projectionToMask() converts dot-notation keys to nested mask.
  //         applyMask() then keeps only those paths.

  describe("parseProjection + applyMask (inclusion projection)", () => {
    it("returns only the projected top-level field", async () => {
      // { name: 1 } — only name survives; age and address are excluded.
      const doc = makeDoc();
      const { repo } = makeRepo({
        find: jest
          .fn()
          .mockReturnValue({ toArray: jest.fn().mockResolvedValue([doc]) }),
      });
      const [result] = await repo.find({}, { projection: { name: 1 } });
      expect(result).toHaveProperty("name");
      expect(result).not.toHaveProperty("age");
      expect(result).not.toHaveProperty("address");
    });

    it("handles dot-notation to project a single nested field", async () => {
      // { "address.city": 1 } → mask { address: { city: 1 } }
      // address.zip and all root fields are excluded.
      const doc = makeDoc();
      const { repo } = makeRepo({
        find: jest
          .fn()
          .mockReturnValue({ toArray: jest.fn().mockResolvedValue([doc]) }),
      });
      const [result] = await repo.find(
        {},
        { projection: { "address.city": 1 } },
      );
      expect(result.address).toHaveProperty("city", "NYC");
      expect(result.address).not.toHaveProperty("zip");
      expect(result).not.toHaveProperty("name");
    });

    it("handles multiple projected fields", async () => {
      // Both name and age projected; address excluded.
      const doc = makeDoc();
      const { repo } = makeRepo({
        find: jest
          .fn()
          .mockReturnValue({ toArray: jest.fn().mockResolvedValue([doc]) }),
      });
      const [result] = await repo.find({}, { projection: { name: 1, age: 1 } });
      expect(result).toHaveProperty("name");
      expect(result).toHaveProperty("age");
      expect(result).not.toHaveProperty("address");
    });

    it("silently drops projected fields that are not in the schema", async () => {
      // Projection mask is intersected with schemaMask — non-schema keys cannot
      // leak through even if the caller explicitly requests them.
      const doc = makeDoc({ internal: "secret" });
      const { repo } = makeRepo({
        find: jest
          .fn()
          .mockReturnValue({ toArray: jest.fn().mockResolvedValue([doc]) }),
      });
      const [result] = await repo.find({}, {
        projection: { name: 1, internal: 1 },
      } as object);
      expect(result).toHaveProperty("name");
      expect(result).not.toHaveProperty("internal");
    });

    it("silently drops a projected nested field not in the schema", async () => {
      // Same as above but for a dot-notation key referencing a non-schema path.
      const doc = makeDoc({
        address: { city: "NYC", zip: "10001", county: "Kings" },
      });
      const { repo } = makeRepo({
        find: jest
          .fn()
          .mockReturnValue({ toArray: jest.fn().mockResolvedValue([doc]) }),
      });
      const [result] = await repo.find({}, {
        projection: { "address.county": 1 },
      } as object);
      expect(result.address).toBeUndefined();
    });
  });

  // ── toDeepPartial (via updateOne validation) ──────────────────────────────
  // Covers: toDeepPartial() wraps every field (including nested) in z.optional().
  // Allows callers to send partial updates without providing the full document shape.

  describe("toDeepPartial", () => {
    it("accepts a patch with only one top-level field", async () => {
      // Only 'name' provided — all other fields optional at runtime.
      const { repo, col } = makeRepo();
      await repo.updateOne({}, { name: "Bob" });
      expect(col.updateOne).toHaveBeenCalled();
    });

    it("accepts a patch with only one nested field (no zip required)", async () => {
      // address.city alone is valid under deep-partial — zip not required.
      const { repo, col } = makeRepo();
      await repo.updateOne({}, {
        address: { city: "LA" },
      } as unknown as Partial<z.infer<typeof TestSchema>>);
      expect(col.updateOne).toHaveBeenCalled();
    });

    it("accepts an empty patch (no fields at all)", async () => {
      // Empty object is valid; it results in an empty $set (no-op update).
      const { repo, col } = makeRepo();
      await repo.updateOne({}, {});
      expect(col.updateOne).toHaveBeenCalled();
    });

    it("still rejects a root field with the wrong type", async () => {
      // Deep-partial makes fields optional, not untyped — wrong type still fails.
      const { repo } = makeRepo();
      await expect(
        repo.updateOne({}, { age: "not-a-number" as unknown as number }),
      ).rejects.toThrow(ZodValidationError);
    });

    it("still rejects a nested field with the wrong type", async () => {
      // Even inside a partial nested object, type constraints must hold.
      const { repo } = makeRepo();
      await expect(
        repo.updateOne({}, {
          address: { city: 99 as unknown as string },
        } as unknown as Partial<z.infer<typeof TestSchema>>),
      ).rejects.toThrow(ZodValidationError);
    });
  });

  // ── toDotNotation (via updateOne $set payload) ────────────────────────────
  // Covers: toDotNotation() flattens nested plain objects to dot-notation.
  // MongoDB $set with dot-notation updates only the specified nested path;
  // passing a nested object would overwrite the entire sub-document.

  describe("toDotNotation", () => {
    it("flattens a singly-nested field to dot-notation", async () => {
      // { address: { city: "LA" } } → $set: { "address.city": "LA" }
      const { repo, col } = makeRepo();
      await repo.updateOne({}, {
        address: { city: "LA" },
      } as unknown as Partial<z.infer<typeof TestSchema>>);
      expect(col.updateOne).toHaveBeenCalledWith(
        {},
        { $set: { "address.city": "LA" } },
        undefined,
      );
    });

    it("flattens multiple nested fields independently", async () => {
      // Both city and zip provided → two separate dot-notation keys.
      const { repo, col } = makeRepo();
      await repo.updateOne({}, { address: { city: "LA", zip: "90001" } });
      expect(col.updateOne).toHaveBeenCalledWith(
        {},
        { $set: { "address.city": "LA", "address.zip": "90001" } },
        undefined,
      );
    });

    it("leaves flat fields as-is (no dot-notation prefix)", async () => {
      // Top-level field must not be prefixed or renamed.
      const { repo, col } = makeRepo();
      await repo.updateOne({}, { name: "Bob" });
      expect(col.updateOne).toHaveBeenCalledWith(
        {},
        { $set: { name: "Bob" } },
        undefined,
      );
    });

    it("does not recurse into arrays (leaves them as leaf values)", async () => {
      // Arrays must be sent as-is; flattening { tags: ["a","b"] } into
      // { "tags.0": "a" } would corrupt the stored array.
      const { repo, col } = makeRepo();
      await repo.updateOne({}, { tags: ["x", "y"] });
      expect(col.updateOne).toHaveBeenCalledWith(
        {},
        { $set: { tags: ["x", "y"] } },
        undefined,
      );
    });

    it("does not recurse into Date values", async () => {
      // Date objects have prototype !== Object.prototype — treated as leaf.
      const DateSchema = z.object({
        _id: z.custom<ObjectId>((v) => v instanceof ObjectId),
        ts: z.date(),
      });
      const col = makeCollection();
      const repo = new BaseRepository(col, DateSchema);
      const date = new Date();
      await repo.updateOne({}, { ts: date });
      expect(getSetArg(col)).toEqual({ ts: date });
    });

    it("$set contains only patched path — sibling path absent", async () => {
      // Verifies the $set payload uses dot-notation so MongoDB only touches
      // address.city. If address.zip appeared in $set it could corrupt data.
      const { repo, col } = makeRepo();
      await repo.updateOne({}, {
        address: { city: "LA" },
      } as unknown as Partial<z.infer<typeof TestSchema>>);
      const $set = getSetArg(col);
      expect($set["address.city"]).toBe("LA");
      expect(Object.keys($set)).not.toContain("address.zip");
    });

    it("forwards UpdateOptions to the driver", async () => {
      const { repo, col } = makeRepo();
      const options = { upsert: true };
      await repo.updateOne({ name: "Alice" }, { name: "Bob" }, options);
      expect(col.updateOne).toHaveBeenCalledWith(
        { name: "Alice" },
        { $set: { name: "Bob" } },
        options,
      );
    });
  });

  // ── findOne ───────────────────────────────────────────────────────────────
  // Covers: NotFoundError thrown on null result; mask applied to found doc;
  //         projection forwarded to driver and used for coercion.

  describe("findOne", () => {
    it("throws NotFoundError when collection returns null", async () => {
      const { repo } = makeRepo({ findOne: jest.fn().mockResolvedValue(null) });
      await expect(repo.findOne({})).rejects.toThrow(NotFoundError);
    });

    it("NotFoundError message is 'Document not found'", async () => {
      // Callers and the HTTP filter rely on this specific message.
      const { repo } = makeRepo({ findOne: jest.fn().mockResolvedValue(null) });
      await expect(repo.findOne({})).rejects.toThrow("Document not found");
    });

    it("strips extra fields from found document", async () => {
      // Same mask logic as find() — extra fields must not leak through.
      const doc = makeDoc({ extra: "strip" });
      const { repo } = makeRepo({ findOne: jest.fn().mockResolvedValue(doc) });
      const result = await repo.findOne({});
      expect(result).not.toHaveProperty("extra");
      expect(result).toHaveProperty("name", "Alice");
    });

    it("applies inclusion projection mask", async () => {
      // Only projected fields returned; others excluded by applyMask.
      const doc = makeDoc();
      const { repo } = makeRepo({ findOne: jest.fn().mockResolvedValue(doc) });
      const result = await repo.findOne({}, { projection: { name: 1 } });
      expect(result).toHaveProperty("name");
      expect(result).not.toHaveProperty("age");
    });

    it("forwards filter and options to the driver", async () => {
      const doc = makeDoc();
      const { repo, col } = makeRepo({
        findOne: jest.fn().mockResolvedValue(doc),
      });
      const filter = { name: "Alice" };
      const options = { projection: { name: 1 } };
      await repo.findOne(filter, options);
      expect(col.findOne).toHaveBeenCalledWith(filter, options);
    });
  });

  // ── deleteOne ─────────────────────────────────────────────────────────────
  // Covers: deleteOne proxies to the driver and returns the raw DeleteResult.
  // Caller is responsible for checking deletedCount.

  describe("deleteOne", () => {
    it("delegates to collection.deleteOne with filter and options", async () => {
      const { repo, col } = makeRepo();
      const filter = { _id: new ObjectId() };
      const options = { comment: "test" };
      await repo.deleteOne(filter, options);
      expect(col.deleteOne).toHaveBeenCalledWith(filter, options);
    });

    it("returns the DeleteResult from the driver", async () => {
      // Caller needs deletedCount to detect not-found.
      const { repo } = makeRepo({
        deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      });
      const result = await repo.deleteOne({});
      expect(result).toEqual({ deletedCount: 1 });
    });

    it("returns deletedCount 0 when no document matched", async () => {
      const { repo } = makeRepo({
        deleteOne: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      });
      const result = await repo.deleteOne({ _id: new ObjectId() });
      expect(result.deletedCount).toBe(0);
    });
  });

  // ── countDocuments ────────────────────────────────────────────────────────
  // Covers: countDocuments proxies filter and options to the driver.

  describe("countDocuments", () => {
    it("returns count from the driver", async () => {
      const { repo } = makeRepo({
        countDocuments: jest.fn().mockResolvedValue(42),
      });
      const result = await repo.countDocuments();
      expect(result).toBe(42);
    });

    it("passes filter to the driver", async () => {
      const { repo, col } = makeRepo();
      const filter = { name: "Alice" };
      await repo.countDocuments(filter);
      expect(col.countDocuments).toHaveBeenCalledWith(filter, undefined);
    });

    it("defaults to empty filter when none provided", async () => {
      // No filter arg → driver receives {} to count all documents.
      const { repo, col } = makeRepo();
      await repo.countDocuments();
      expect(col.countDocuments).toHaveBeenCalledWith({}, undefined);
    });
  });

  // ── parseId ───────────────────────────────────────────────────────────────
  // Covers: valid hex strings produce ObjectId; invalid strings throw InvalidIdError.

  describe("parseId", () => {
    it("returns an ObjectId with the same hex value", async () => {
      // Round-trip: toHexString() on the result must equal the input.
      const { repo } = makeRepo();
      const hex = new ObjectId().toHexString();
      const result = repo.parseId(hex);
      expect(result).toBeInstanceOf(ObjectId);
      expect(result.toHexString()).toBe(hex);
    });

    it("throws InvalidIdError for a non-hex string", async () => {
      const { repo } = makeRepo();
      expect(() => repo.parseId("not-an-id")).toThrow(InvalidIdError);
    });

    it("throws InvalidIdError for an empty string", async () => {
      const { repo } = makeRepo();
      expect(() => repo.parseId("")).toThrow(InvalidIdError);
    });

    it("InvalidIdError message includes the rejected id", async () => {
      // HTTP filter surfaces this message as the 400 body.
      const { repo } = makeRepo();
      expect(() => repo.parseId("bad")).toThrow("Invalid id: bad");
    });
  });

  // ── collection accessor ───────────────────────────────────────────────────

  describe("collection", () => {
    it("exposes the underlying Collection for advanced queries", () => {
      // Services that need aggregation or custom indexes access repo.collection directly.
      const col = makeCollection();
      const repo = new BaseRepository(col, TestSchema);
      expect(repo.collection).toBe(col);
    });
  });

  // ── integration: real MongoDB (mongodb-memory-server) ─────────────────────
  // Unit tests above mock the driver and cannot verify that the $set payload
  // actually preserves sibling fields in stored documents.
  // These tests run against a real in-process MongoDB instance.

  describe("integration (real MongoDB)", () => {
    let mongod: MongoMemoryServer;
    let client: MongoClient;
    let repo: BaseRepository<typeof TestSchema>;

    beforeAll(async () => {
      mongod = await MongoMemoryServer.create();
      client = new MongoClient(mongod.getUri());
      await client.connect();
      repo = new BaseRepository(
        client.db("test").collection("docs"),
        TestSchema,
      );
    });

    afterAll(async () => {
      await client.close();
      await mongod.stop();
    });

    it("insert + find round-trips the document correctly", async () => {
      // Verifies the full insert→find cycle preserves all fields.
      const doc = {
        _id: new ObjectId(),
        name: "Bob",
        age: 25,
        tags: ["t"],
        address: { city: "SF", zip: "94105" },
      };
      await repo.insertOne(doc);
      const [found] = await repo.find({ _id: doc._id });
      expect(found.name).toBe("Bob");
      expect(found.address.city).toBe("SF");
      expect(found.tags).toEqual(["t"]);
    });

    it("updateOne with dot-notation preserves sibling field in stored document", async () => {
      // This is the key guarantee of toDotNotation: updating address.city must
      // not overwrite address.zip. Only provable against a real MongoDB instance.
      const doc = {
        _id: new ObjectId(),
        name: "Alice",
        age: 30,
        tags: [],
        address: { city: "NYC", zip: "10001" },
      };
      await repo.insertOne(doc);
      await repo.updateOne({ _id: doc._id }, {
        address: { city: "LA" },
      } as unknown as Partial<z.infer<typeof TestSchema>>);
      const updated = await repo.findOne({ _id: doc._id });
      expect(updated.address.city).toBe("LA");
      expect(updated.address.zip).toBe("10001");
    });

    it("updateOne with full nested object replaces the sub-document", async () => {
      // When both fields are provided, both are updated via separate dot-notation keys.
      const doc = {
        _id: new ObjectId(),
        name: "Carol",
        age: 40,
        tags: [],
        address: { city: "NYC", zip: "10001" },
      };
      await repo.insertOne(doc);
      await repo.updateOne(
        { _id: doc._id },
        { address: { city: "LA", zip: "90001" } },
      );
      const updated = await repo.findOne({ _id: doc._id });
      expect(updated.address.city).toBe("LA");
      expect(updated.address.zip).toBe("90001");
    });

    it("findOne throws NotFoundError for unknown _id", async () => {
      await expect(repo.findOne({ _id: new ObjectId() })).rejects.toThrow(
        NotFoundError,
      );
    });
  });
});
