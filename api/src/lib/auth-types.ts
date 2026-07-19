export type Role = "admin" | "player";

export function isRole(value: unknown): value is Role {
  return value === "admin" || value === "player";
}
