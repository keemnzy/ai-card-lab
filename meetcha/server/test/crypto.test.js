import { test } from "node:test";
import assert from "node:assert/strict";
import { cmac, verifySun } from "../src/crypto.js";

const hex = (s) => Buffer.from(s, "hex");

test("AES-CMAC: RFC 4493 테스트 벡터", () => {
  const key = hex("2b7e151628aed2a6abf7158809cf4f3c");
  assert.equal(cmac(key, Buffer.alloc(0)).toString("hex"), "bb1d6929e95937287fa37d129b756746");
  assert.equal(cmac(key, hex("6bc1bee22e409f96e93d7e117393172a")).toString("hex"), "070a16b46b4d4144f79bdd9dd04a287c");
  assert.equal(
    cmac(key, hex("6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411")).toString("hex"),
    "dfa66747de9ae63030ca32611497c827",
  );
});

test("SUN: NXP AN12196 예시 (키 전부 0)", () => {
  const zero = Buffer.alloc(16);
  const r = verifySun("EF963FF7828658A599F3041510671E88", "94EED9EE65337086", { metaKey: zero, fileKeyFor: () => zero });
  assert.deepEqual(r, { uid: "04DE5F1EACC040", counter: 61 });
});

test("SUN: MAC이 틀리면 거부", () => {
  const zero = Buffer.alloc(16);
  assert.equal(verifySun("EF963FF7828658A599F3041510671E88", "94EED9EE65337087", { metaKey: zero, fileKeyFor: () => zero }), null);
  assert.equal(verifySun("not-hex", "94EED9EE65337086", { metaKey: zero, fileKeyFor: () => zero }), null);
});
