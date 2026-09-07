/**
 * El puente, de punta a punta y sin red: una prueba de verdad firmada por una cuenta de
 * verdad entra por `/authorize/complete`, sale un `code`, y `/token` lo canjea por un
 * `id_token` que verifica contra el JWKS.
 *
 * Lo que se fija, además del camino feliz, es lo que NO puede pasar: un código que se usa
 * dos veces, un PKCE que no cuadra, una URL de retorno que no es la registrada y una
 * prueba dirigida a otro.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { Identity } from '@dotrino/identity/node'
import { newAssertionNonce } from '@dotrino/identity/assertion'

const require_ = createRequire(import.meta.url)
const ISSUER = 'https://sso.dotrino.com'
const REDIR = 'https://app.ejemplo.com/callback'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sso-'))
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** El puente, escuchando en un puerto libre, con su fichero de clientes. */
async function puente () {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, 'clients.json'), JSON.stringify({
    'app-de-ejemplo': { client_id: 'app-de-ejemplo', name: 'App de ejemplo', redirect_uris: [REDIR] }
  }))
  const { createBridge } = require_('../server/server.js')
  const b = createBridge({
    issuer: ISSUER,
    keyFile: path.join(dir, 'k.pem'),
    clientsFile: path.join(dir, 'clients.json')
  })
  await new Promise((r) => b.server.listen(0, r))
  const base = 'http://127.0.0.1:' + b.server.address().port
  return { base, dir, cierra: () => { b.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}

/** Una cuenta que pide su prueba para el puente, como haría la página de `/authorize`. */
async function pruebaDe (nonce, audience = ISSUER, scopes = ['id:whoami']) {
  const dir = tmp()
  const id = await Identity.connect({ dir })
  const assertion = await id.requestAssertion({ audience, nonce, scopes })
  const profileId = (await id.profileActa())?.acta?.profileId || id.me.publickey
  fs.rmSync(dir, { recursive: true, force: true })
  return { assertion, profileId }
}

const completar = (base, body) => fetch(base + '/authorize/complete', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
})
const canjear = (base, params) => fetch(base + '/token', {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params)
})

test('el camino entero: prueba de la bóveda → code → id_token verificable', async () => {
  const p = await puente()
  const verifier = b64url(crypto.randomBytes(32))
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
  const nonce = newAssertionNonce()
  const { assertion, profileId } = await pruebaDe(nonce)

  const r1 = await completar(p.base, { assertion, nonce, client_id: 'app-de-ejemplo', redirect_uri: REDIR, challenge, nonceIn: 'n-de-la-app' })
  assert.equal(r1.status, 200)
  const { code } = await r1.json()
  assert.ok(code)

  const r2 = await canjear(p.base, { grant_type: 'authorization_code', code, client_id: 'app-de-ejemplo', redirect_uri: REDIR, code_verifier: verifier })
  assert.equal(r2.status, 200)
  const tok = await r2.json()
  assert.equal(tok.token_type, 'Bearer')

  // Y el token se verifica con lo que publica el JWKS, como haría cualquier librería OIDC.
  const { verifyJwt } = require_('../server/jwt.js')
  const jwk = (await (await fetch(p.base + '/jwks.json')).json()).keys[0]
  const pub = crypto.createPublicKey({ key: { ...jwk, kty: 'EC' }, format: 'jwk' })
  const claims = verifyJwt(tok.id_token, pub)
  assert.equal(claims.iss, ISSUER)
  // El `sub` es la HUELLA de la identidad: corta y estable, que es lo que un integrador
  // va a guardar. La llave entera viaja aparte, para quien la necesite.
  const { pubkeyId } = await import('@dotrino/identity/keyid')
  assert.equal(claims.sub, await pubkeyId(profileId), 'el sub es la identidad, la misma en todas partes')
  assert.match(claims.sub, /^[0-9a-f]{64}$/)
  assert.equal(claims.dotrino_pubkey, profileId)
  assert.equal(claims.aud, 'app-de-ejemplo')
  assert.equal(claims.nonce, 'n-de-la-app', 'el nonce de la app vuelve en el token')
  p.cierra()
})

test('un código se canjea UNA vez', async () => {
  const p = await puente()
  const verifier = b64url(crypto.randomBytes(32))
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
  const nonce = newAssertionNonce()
  const { assertion } = await pruebaDe(nonce)
  const { code } = await (await completar(p.base, { assertion, nonce, client_id: 'app-de-ejemplo', redirect_uri: REDIR, challenge })).json()

  const args = { grant_type: 'authorization_code', code, client_id: 'app-de-ejemplo', redirect_uri: REDIR, code_verifier: verifier }
  assert.equal((await canjear(p.base, args)).status, 200)
  assert.equal((await canjear(p.base, args)).status, 400, 'el segundo intento ya no vale')
  p.cierra()
})

test('sin el verificador correcto no hay token (PKCE)', async () => {
  const p = await puente()
  const challenge = b64url(crypto.createHash('sha256').update(b64url(crypto.randomBytes(32))).digest())
  const nonce = newAssertionNonce()
  const { assertion } = await pruebaDe(nonce)
  const { code } = await (await completar(p.base, { assertion, nonce, client_id: 'app-de-ejemplo', redirect_uri: REDIR, challenge })).json()

  const r = await canjear(p.base, { grant_type: 'authorization_code', code, client_id: 'app-de-ejemplo', redirect_uri: REDIR, code_verifier: b64url(crypto.randomBytes(32)) })
  assert.equal(r.status, 400)
  assert.equal((await r.json()).error, 'invalid_grant')
  p.cierra()
})

test('una prueba dirigida a OTRO no entra aquí', async () => {
  const p = await puente()
  const nonce = newAssertionNonce()
  const { assertion } = await pruebaDe(nonce, 'https://sso.otracosa.com')
  const r = await completar(p.base, { assertion, nonce, client_id: 'app-de-ejemplo', redirect_uri: REDIR, challenge: 'x'.repeat(43) })
  assert.equal(r.status, 401)
  assert.match((await r.json()).error_description, /otro-destinatario/)
  p.cierra()
})

test('la URL de retorno se compara entera, no por prefijo', async () => {
  const p = await puente()
  const nonce = newAssertionNonce()
  const { assertion } = await pruebaDe(nonce)
  const r = await completar(p.base, { assertion, nonce, client_id: 'app-de-ejemplo', redirect_uri: REDIR + '?next=https://otro.com', challenge: 'x'.repeat(43) })
  assert.equal(r.status, 400, 'un prefijo dejaría colar el código a otra parte')
  p.cierra()
})

test('lo que publica para que una librería OIDC lo entienda', async () => {
  const p = await puente()
  const cfg = await (await fetch(p.base + '/.well-known/openid-configuration')).json()
  assert.equal(cfg.issuer, ISSUER)
  assert.deepEqual(cfg.code_challenge_methods_supported, ['S256'], 'plain no se acepta')
  assert.deepEqual(cfg.response_types_supported, ['code'], 'nada de flujo implícito')
  assert.deepEqual(cfg.id_token_signing_alg_values_supported, ['ES256'])
  p.cierra()
})

test('`/authorize` exige cliente conocido, retorno registrado y PKCE', async () => {
  const p = await puente()
  const q = (s) => fetch(p.base + '/authorize?' + s).then((r) => r.status)
  assert.equal(await q('client_id=nadie&redirect_uri=' + encodeURIComponent(REDIR)), 400)
  assert.equal(await q('client_id=app-de-ejemplo&redirect_uri=https://otro.com'), 400)
  assert.equal(await q('client_id=app-de-ejemplo&redirect_uri=' + encodeURIComponent(REDIR)), 400, 'sin PKCE, no')
  assert.equal(await q('client_id=app-de-ejemplo&redirect_uri=' + encodeURIComponent(REDIR) + '&code_challenge_method=S256&code_challenge=' + 'x'.repeat(43)), 200)
  p.cierra()
})

test('la landing la sirve el propio servicio, y no deja pedir otra cosa', async () => {
  const p = await puente()
  const home = await fetch(p.base + '/')
  assert.equal(home.status, 200)
  assert.match(home.headers.get('content-type'), /text\/html/)
  const html = await home.text()
  // Lenguaje llano (§9.1): «SSO» es argot y no aparece de cara al público.
  assert.ok(!/\bSSO\b/.test(html.replace(/sso\.dotrino\.com|dotrino-sso|sso-client/g, '')), 'nada de argot en la copy')
  assert.match(html, /dotrino-topbar/, 'la barra estándar (§5)')
  assert.match(html, /goat\.dotrino\.com/, 'la analítica del ecosistema (§8)')
  assert.match(html, /data-lang="en"/, 'bilingüe (§9)')

  assert.equal((await fetch(p.base + '/robots.txt')).status, 200)
  assert.equal((await fetch(p.base + '/sitemap.xml')).status, 200)
  // La lista de estáticos es cerrada: no se compone una ruta con lo que venga de fuera.
  assert.equal((await fetch(p.base + '/../server/server.js')).status, 404)
  assert.equal((await fetch(p.base + '/clients.json')).status, 404)
  p.cierra()
})
