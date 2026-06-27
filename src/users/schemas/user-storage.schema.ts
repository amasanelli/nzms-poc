import { ObjectId } from "mongodb";
import { z } from "zod";
import { BaseRepository } from "../../database/database.repository";

export const UserStorageSchema = z.object({
  _id: z.custom<ObjectId>((v) => v instanceof ObjectId),
  createdAt: z.date(),
  updatedAt: z.date(),
  name: z.string().optional(),
  email: z.string(),
  age: z.number().int().min(0).max(150),
  role: z.enum(["admin", "user", "guest"]),
});

export type UserDocument = z.infer<typeof UserStorageSchema>;
export type UsersRepository = BaseRepository<typeof UserStorageSchema>;
