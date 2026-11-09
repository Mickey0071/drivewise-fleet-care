import { describe, expect, it } from "vitest";
import { isPublicRoute } from "./public-routes";

describe("contract link access", () => {
  it("opens rent-to-own signature links without an account", () => {
    expect(isPublicRoute("/rto-sign/0123456789abcdef0123456789abcdef")).toBe(true);
  });
  it("keeps the rent-to-own administration page private", () => {
    expect(isPublicRoute("/rent-to-own")).toBe(false);
  });
  it("keeps ordinary rental signature links public", () => {
    expect(isPublicRoute("/rent/example-token")).toBe(true);
  });
});