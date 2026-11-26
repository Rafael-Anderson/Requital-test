import { describe, expect, it } from "vitest";
import { credentialProblem } from "./credential-validation";

describe("admin credential validation (mirror of the backend)", () => {
  it("flags a webhook URL, whitespace, a bad Nomod secret and Stripe prefixes", () => {
    expect(credentialProblem("nomod", "apiKey", "https://x.test/a")).toMatch(/webhook URL/);
    expect(credentialProblem("nomod", "apiKey", "a b")).toMatch(/spaces/);
    expect(credentialProblem("nomod", "webhookSecret", "whsec_x")).toMatch(/not valid/);
    expect(credentialProblem("nomod", "webhookSecret", "whsec_c2VjcmV0")).toBeNull();
    expect(credentialProblem("stripe", "secretKey", "pk_live_a")).toMatch(/sk_live_/);
    expect(credentialProblem("stripe", "secretKey", "rk_test_a")).toBeNull();
    expect(credentialProblem("stripe", "webhookSecret", "abc")).toMatch(/whsec_/);
    expect(credentialProblem("tabby", "secretKey", "https://x")).toBeNull();
  });
});
