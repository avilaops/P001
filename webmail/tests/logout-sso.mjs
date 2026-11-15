import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const fonte = readFileSync(new URL("../src/lib/sso.ts", import.meta.url), "utf8");
const compilado = ts.transpileModule(fonte, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function logout(clientId) {
  const contexto = {
    exports: {}, URL, URLSearchParams,
    process: { env: {
      AUTH_URL: "https://auth.avilaops.com",
      WEBMAIL_URL: "https://mail.avilaops.com",
      ...(clientId === undefined ? {} : { AUTH_CLIENT_ID: clientId }),
    } },
    require: () => ({}),
  };
  vm.runInNewContext(compilado, contexto);
  return new URL(contexto.exports.urlLogoutSso());
}

for (const clientId of [undefined, "", "   "]) {
  const url = logout(clientId);
  assert.equal(url.origin, "https://auth.avilaops.com");
  assert.equal(url.pathname, "/api/auth/logout");
  assert.equal(url.searchParams.get("app"), "mail");
  assert.equal(url.searchParams.get("returnTo"), "https://mail.avilaops.com/entrar?local=1");
  assert.equal(url.searchParams.has("client_id"), false);
  assert.equal(url.searchParams.has("post_logout_redirect_uri"), false,
    "Logout legado não pode selecionar o protocolo OIDC sem identificar o cliente");
}

const oidc = logout("  mail-production  ");
assert.equal(oidc.searchParams.get("client_id"), "mail-production");
assert.equal(oidc.searchParams.get("post_logout_redirect_uri"), "https://mail.avilaops.com/entrar?local=1");
assert.equal(oidc.searchParams.get("app"), "mail");
console.log("Logout SSO • legado e OIDC aprovados");
