import { z } from "zod";
import { UserSchema } from "./user-service.schema";

export const CreateUserSchema = UserSchema;
export const UpdateUserSchema = UserSchema.partial();

export const UserResponseSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  email: z.string(),
  age: z.number(),
  role: z.enum(["admin", "user", "guest"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const UserResponseListSchema = z.array(UserResponseSchema);

export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
export type UserResponse = z.infer<typeof UserResponseSchema>;
