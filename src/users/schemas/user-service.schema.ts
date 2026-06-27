import { z } from "zod";

export const UserSchema = z.object({
  name: z.string().min(2).max(50).optional(),
  email: z.email(),
  yearOfBirth: z
    .number()
    .int()
    .min(1900)
    .refine((v) => v <= new Date().getFullYear(), {
      message: "yearOfBirth cannot be in the future",
    }),
  role: z.enum(["admin", "user", "guest"]).default("user"),
});

export type User = z.infer<typeof UserSchema>;
