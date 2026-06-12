import assert from "node:assert/strict";
import test from "node:test";
import Core from "../index.js";

test("exports framework primitives", () => {
  assert.equal(typeof Core.Application, "function");
  assert.equal(typeof Core.ParamValidator.verify, "function");
  assert.equal(typeof Core.JwtManager, "function");
});

test("validates optional params when a value is provided", () => {
  const request = {
    method: "GET",
    query: { page: "abc" },
    params: {},
  };
  const invalidParams = [];

  const ok = Core.ParamValidator.verify(request, [{ name: "page", type: "integer", optional: true }], invalidParams);

  assert.equal(ok, false);
  assert.deepEqual(invalidParams, ["page"]);
});

test("coerces valid numeric optional params", () => {
  const request = {
    method: "GET",
    query: { page: "2" },
    params: {},
  };

  const ok = Core.ParamValidator.verify(request, [{ name: "page", type: "integer", optional: true }]);

  assert.equal(ok, true);
  assert.equal(request.params.page, 2);
});

test("requires jwt secret in production", () => {
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalYsApiMode = process.env.YS_API_MODE;

  delete process.env.JWT_SECRET;
  delete process.env.YS_API_MODE;
  process.env.NODE_ENV = "production";

  try {
    assert.throws(() => new Core.JwtManager({}), /JWT secret is required in production/);
  } finally {
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;

    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;

    if (originalYsApiMode === undefined) delete process.env.YS_API_MODE;
    else process.env.YS_API_MODE = originalYsApiMode;
  }
});
