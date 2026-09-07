'use strict';

/**
 * dotrino-sso — el puente entre la bóveda del usuario y el mundo que habla OpenID Connect.
 *
 * Hacia dentro: la prueba firmada de `@dotrino/identity` (`aud` + `nonce` + `exp`, con la
 * cadena de actas). Hacia fuera: un proveedor OIDC del montón, para que quien integre no
 * tenga que aprender nada de Dotrino.
 *
 * LO QUE ESTE SERVICIO ES, Y NO DISIMULA: un tercero de confianza. No ve la llave del
 * usuario ni su contenido, pero sí VE EN QUÉ APLICACIÓN ENTRA. Es el rol que el ecosistema
 * evita por diseño, y por eso está acotado por tres reglas duras (README §3):
 *
 *   1. **Se puede autohospedar** — `sso.tuempresa.com`, sin nada de Dotrino corriendo.
 *   2. **No guarda nada.** Ni usuarios, ni accesos, ni direcciones IP. Solo códigos en
 *      vuelo, en memoria, que viven segundos.
 *   3. **Hay camino directo**: quien no quiera intermediario verifica la prueba él mismo
 *      con `@dotrino/sso-client`, y este servicio no participa.
 *
 * Solo *Authorization Code* con PKCE. Nada de flujo implícito ni de contraseñas: aquí no
 * hay ninguna contraseña que dar.
 */

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { loadOrCreateKey, jwks, signJwt, b64url } = require('./jwt.js');

const PORT = Number(process.env.PORT || 8093);

/**
 * Las aplicaciones registradas. Fichero declarativo y revisado, no autorregistro abierto:
 * el nombre que se guarda aquí es el que el usuario ve en la pantalla de permiso, y dejar
 * que cualquiera se anuncie con el nombre que quiera es regalar la mitad de un engaño.
 * (Decisión pendiente en `docs/DISENO.md` §10, resuelta así el 2026-09-06.)
 */
function loadClients(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return {}; }
}

const json = (res, status, obj, extra = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*', ...extra });
    res.end(JSON.stringify(obj));
};
const readBody = (req) => new Promise((resolve, reject) => {
    let b = ''; req.on('data', (c) => { b += c; if (b.length > 64 * 1024) reject(new Error('body too large')); });
    req.on('end', () => resolve(b)); req.on('error', reject);
});
const form = (s) => Object.fromEntries(new URLSearchParams(s));

/** PKCE S256: el único método que se acepta. `plain` no protege de nada. */
const pkceOk = (verifier, challenge) =>
    typeof verifier === 'string' && verifier.length >= 43 &&
    b64url(crypto.createHash('sha256').update(verifier).digest()) === challenge;

/** La página que habla con la bóveda. Se sirve desde aquí para que no haya nada que instalar. */
function authorizePage({ issuer, vaultUrl, client, state, nonceIn, scopes, redirect_uri, challenge }) {
    const cfg = JSON.stringify({ issuer, vault: vaultUrl, client: { id: client.client_id, name: client.name }, state, nonceIn, scopes, redirect_uri, challenge });
    return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Entrar con Dotrino</title>
<style>
 :root{color-scheme:dark}
 body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
      background:#0b0820;color:#e7e3ff;font-family:system-ui,-apple-system,Segoe UI,sans-serif}
 .card{background:#171331;border:1px solid #2a2350;border-radius:16px;padding:26px;max-width:min(420px,92vw)}
 h1{font-size:19px;margin:0 0 6px} p{opacity:.75;font-size:14px;line-height:1.5;margin:6px 0}
 .app{font-weight:700;color:#fff} .err{color:#e5484d}
 button{width:100%;margin-top:14px;padding:11px;border:0;border-radius:10px;background:#7c3aed;color:#fff;font:inherit;font-weight:600;cursor:pointer}
</style></head><body><div class="card">
 <h1>Entrar con Dotrino</h1>
 <p><span class="app">${escapeHtml(client.name)}</span> quiere saber quién eres.</p>
 <p>Tu llave no sale de tu dispositivo, y este servicio no guarda nada de lo que pase aquí.</p>
 <div id="estado"><button id="go">Continuar</button></div>
</div>
<script type="module">
const CFG = ${cfg};
const el = document.getElementById('estado');
const decir = (t, mal) => { el.innerHTML = '<p class="' + (mal ? 'err' : '') + '">' + t + '</p>'; };
document.getElementById('go').addEventListener('click', async () => {
  decir('Preguntando a tu bóveda…');
  try {
    // El pin va por MINOR: jsDelivr sirve el último parche de esa rama, así que los
    // arreglos entran solos. La minor sí hay que subirla a mano al usar algo nuevo —
    // onBehalfOf llegó en 0.87 y con el pin anterior se ignoraba en silencio.
    // (Sin acentos graves aquí dentro: esto vive en una plantilla y los cerraría.)
    const { Identity, newAssertionNonce } = await import('https://cdn.jsdelivr.net/npm/@dotrino/identity@0.87/+esm');
    const id = await Identity.connect({ vaultUrl: CFG.vault });
    const nonce = newAssertionNonce();
    // El destinatario es ESTE puente: la prueba no sirve ante ningún otro.
    // EN NOMBRE DE QUIÉN pedimos. Sin esto, todas las aplicaciones que entran por este
    // puente se verían en la bóveda como una sola —«Sso»— y el usuario no sabría a quién
    // le está dejando entrar. El nombre sale del registro, no de la petición.
    const assertion = await id.requestAssertion({ audience: CFG.issuer, nonce, scopes: CFG.scopes, onBehalfOf: CFG.client.name });
    const r = await fetch(CFG.issuer + '/authorize/complete', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assertion, nonce, client_id: CFG.client.id, redirect_uri: CFG.redirect_uri, challenge: CFG.challenge })
    });
    const out = await r.json();
    if (!r.ok) return decir(out.error_description || out.error || 'No se pudo entrar.', true);
    const u = new URL(CFG.redirect_uri);
    u.searchParams.set('code', out.code);
    if (CFG.state) u.searchParams.set('state', CFG.state);
    location.replace(u.toString());
  } catch (e) { decir((e && e.message) || 'No se pudo hablar con tu bóveda.', true); }
});
</script></body></html>`;
}
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * UN PUENTE, con su configuración y sus códigos propios.
 *
 * Es una factoría y no un módulo con estado global porque así se puede levantar más de uno
 * —en las pruebas, o un mismo proceso sirviendo dos dominios— y porque un `require` que
 * cachea un servidor ya cerrado es un fallo que solo aparece en el segundo test.
 */
function createBridge({
    issuer,
    keyFile = path.join(process.env.HOME || '/tmp', '.dotrino-sso', 'signing-key.pem'),
    clientsFile = path.join(__dirname, 'clients.json'),
    vaultUrl = 'https://id.dotrino.com/',
    codeTtlMs = 60 * 1000,
    tokenTtlS = 10 * 60,
    signingKey = null
} = {}) {
    const ISSUER = String(issuer || '').trim().replace(/\/+$/, '');
    if (!ISSUER) throw new Error('createBridge: issuer required');
    const VAULT_URL = String(vaultUrl).replace(/\/*$/, '/');
    const CODE_TTL_MS = codeTtlMs;
    const TOKEN_TTL_S = tokenTtlS;
    const key = signingKey || loadOrCreateKey(keyFile);

    /** Códigos en vuelo. En memoria y con vencimiento de segundos: no hay nada que filtrar. */
    const codes = new Map();
    const sweep = () => { const t = Date.now(); for (const [k, v] of codes) if (v.exp <= t) codes.delete(k); };

    const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, ISSUER || `http://localhost:${PORT}`);
    try {
        if (req.method === 'OPTIONS') return json(res, 204, {});

        // ---- Lo que un proveedor OIDC tiene que publicar ----
        if (url.pathname === '/.well-known/openid-configuration') {
            return json(res, 200, {
                issuer: ISSUER,
                authorization_endpoint: ISSUER + '/authorize',
                token_endpoint: ISSUER + '/token',
                jwks_uri: ISSUER + '/jwks.json',
                userinfo_endpoint: ISSUER + '/userinfo',
                response_types_supported: ['code'],
                grant_types_supported: ['authorization_code'],
                // Solo S256: `plain` deja el reto a la vista de quien mire el tráfico.
                code_challenge_methods_supported: ['S256'],
                id_token_signing_alg_values_supported: ['ES256'],
                scopes_supported: ['openid', 'profile', 'email'],
                subject_types_supported: ['public'],
                token_endpoint_auth_methods_supported: ['none']
            });
        }
        if (url.pathname === '/jwks.json') return json(res, 200, jwks(key));
        if (url.pathname === '/health') return json(res, 200, { ok: true });

        // ---- La landing (CONVENCIONES §1.2). La sirve el propio servicio y no un
        // estático aparte, para que desplegarla siga siendo el mismo `git pull` que todo
        // lo demás: una pieza menos que se puede quedar atrás sin que nadie lo note. ----
        if (req.method === 'GET') {
            const estatico = {
                '/': ['index.html', 'text/html; charset=utf-8'],
                '/index.html': ['index.html', 'text/html; charset=utf-8'],
                '/icon.svg': ['icon.svg', 'image/svg+xml'],
                '/og.jpg': ['og.jpg', 'image/jpeg'],
                '/robots.txt': ['robots.txt', 'text/plain; charset=utf-8'],
                '/sitemap.xml': ['sitemap.xml', 'application/xml; charset=utf-8']
            }[url.pathname];
            if (estatico) {
                const f = path.join(__dirname, '..', 'web', estatico[0]);
                // La lista de arriba es cerrada: no se compone una ruta con lo que venga de
                // fuera, así que no hay forma de pedir un archivo que no esté en ella.
                if (fs.existsSync(f)) {
                    res.writeHead(200, { 'content-type': estatico[1], 'cache-control': 'public, max-age=600' });
                    return res.end(fs.readFileSync(f));
                }
            }
        }

        // ---- 1) La aplicación manda aquí al usuario ----
        if (url.pathname === '/authorize' && req.method === 'GET') {
            const clients = loadClients(clientsFile);
            const client = clients[url.searchParams.get('client_id') || ''];
            const redirect_uri = url.searchParams.get('redirect_uri') || '';
            if (!client) return json(res, 400, { error: 'invalid_client' });
            // La URL de retorno se compara ENTERA con las registradas: un prefijo deja
            // colar `?next=` y con eso el código se va a otra parte.
            if (!Array.isArray(client.redirect_uris) || !client.redirect_uris.includes(redirect_uri)) {
                return json(res, 400, { error: 'invalid_request', error_description: 'redirect_uri no registrada' });
            }
            const challenge = url.searchParams.get('code_challenge') || '';
            if (url.searchParams.get('code_challenge_method') !== 'S256' || challenge.length < 43) {
                return json(res, 400, { error: 'invalid_request', error_description: 'PKCE S256 obligatorio' });
            }
            const pedidos = String(url.searchParams.get('scope') || 'openid').split(/\s+/).filter(Boolean);
            const scopes = ['id:whoami']
                .concat(pedidos.includes('profile') ? ['profile:name', 'profile:avatar'] : [])
                .concat(pedidos.includes('email') ? ['profile:email'] : []);
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
            return res.end(authorizePage({
                issuer: ISSUER, vaultUrl: VAULT_URL,
                client, state: url.searchParams.get('state') || '', nonceIn: url.searchParams.get('nonce') || '',
                scopes, redirect_uri, challenge
            }));
        }

        // ---- 2) La página trae la prueba de la bóveda; aquí se verifica y sale el `code` ----
        if (url.pathname === '/authorize/complete' && req.method === 'POST') {
            const b = JSON.parse((await readBody(req)) || '{}');
            const clients = loadClients(clientsFile);
            const client = clients[b.client_id || ''];
            if (!client || !client.redirect_uris?.includes(b.redirect_uri)) return json(res, 400, { error: 'invalid_client' });

            const { verifyAssertion } = await import('@dotrino/identity/assertion');
            const { pubkeyId } = await import('@dotrino/identity/keyid');
            const v = await verifyAssertion(b.assertion, { audience: ISSUER, nonce: b.nonce });
            if (!v.ok) return json(res, 401, { error: 'access_denied', error_description: 'la prueba no vale: ' + v.reason });

            sweep();
            const code = b64url(crypto.randomBytes(32));
            codes.set(code, {
                client_id: b.client_id, redirect_uri: b.redirect_uri, challenge: b.challenge,
                // EL `sub` ES LA HUELLA, no la llave entera. La llave serializada arrastra
                // `ext` y `key_ops` —cómo se exportó, no quién es—, así que un día podría
                // salir distinta para la misma persona; y el `sub` es justo el campo que un
                // integrador guarda como clave primaria. La huella es corta y estable.
                sub: await pubkeyId(v.profileId), pubkey: v.profileId,
                claims: v.claims || {}, scopes: v.scopes || [],
                nonceIn: b.nonceIn || '', exp: Date.now() + CODE_TTL_MS
            });
            return json(res, 200, { code });
        }

        // ---- 3) El backend del tercero canjea el código ----
        if (url.pathname === '/token' && req.method === 'POST') {
            const p = form(await readBody(req));
            sweep();
            const rec = codes.get(p.code || '');
            // Un código se canjea UNA vez: se borra al mirarlo, valga o no.
            if (rec) codes.delete(p.code);
            if (!rec || rec.exp <= Date.now()) return json(res, 400, { error: 'invalid_grant' });
            if (p.grant_type !== 'authorization_code') return json(res, 400, { error: 'unsupported_grant_type' });
            if (p.client_id !== rec.client_id || p.redirect_uri !== rec.redirect_uri) return json(res, 400, { error: 'invalid_grant' });
            if (!pkceOk(p.code_verifier, rec.challenge)) return json(res, 400, { error: 'invalid_grant', error_description: 'PKCE no cuadra' });

            const now = Math.floor(Date.now() / 1000);
            const payload = {
                iss: ISSUER, sub: rec.sub, aud: rec.client_id, iat: now, exp: now + TOKEN_TTL_S,
                // La llave entera va aparte, para quien quiera verificar algo firmado por
                // esta persona sin tener que pedírsela otra vez.
                dotrino_pubkey: rec.pubkey,
                ...(rec.nonceIn ? { nonce: rec.nonceIn } : {}),
                ...(rec.claims.name ? { name: rec.claims.name } : {}),
                ...(rec.claims.avatar ? { picture: rec.claims.avatar } : {}),
                // El correo va SIN `email_verified`: nadie lo ha respaldado todavía, y
                // decir que sí sería mentir en el campo que más se usa como clave primaria.
                ...(rec.claims.email ? { email: rec.claims.email } : {})
            };
            return json(res, 200, { token_type: 'Bearer', expires_in: TOKEN_TTL_S, id_token: signJwt(payload, key), scope: 'openid' });
        }

        // ---- `userinfo`: lo mismo que ya va en el token, para quien lo pida aparte ----
        if (url.pathname === '/userinfo') {
            const auth = String(req.headers.authorization || '');
            const tok = auth.startsWith('Bearer ') ? auth.slice(7) : '';
            const { verifyJwt } = require('./jwt.js');
            const claims = verifyJwt(tok, crypto.createPublicKey(key));
            if (!claims || claims.exp * 1000 <= Date.now()) return json(res, 401, { error: 'invalid_token' });
            const { iss, aud, iat, exp, nonce, ...resto } = claims;
            return json(res, 200, resto);
        }

        return json(res, 404, { error: 'not_found' });
        } catch (e) {
            return json(res, 500, { error: 'server_error', error_description: e?.message || String(e) });
        }
    });

    const timer = setInterval(sweep, 30_000);
    timer.unref();
    return { server, codes, issuer: ISSUER, close: () => { clearInterval(timer); server.close(); } };
}

function main() {
    // SIN URL PÚBLICA NO SE ARRANCA: el `issuer` es el destinatario de las pruebas y va
    // firmado dentro de ellas. Adivinarlo sería aceptar pruebas dirigidas a otro.
    const issuer = String(process.env.SSO_ISSUER || '').trim();
    if (!issuer) {
        console.error('[sso] SSO_ISSUER is required: the public URL of this bridge (e.g. https://sso.dotrino.com)');
        process.exit(1);
    }
    const bridge = createBridge({
        issuer,
        keyFile: process.env.SSO_KEY_FILE,
        clientsFile: process.env.SSO_CLIENTS_FILE,
        vaultUrl: process.env.SSO_VAULT_URL,
        codeTtlMs: Number(process.env.SSO_CODE_TTL_MS) || undefined,
        tokenTtlS: Number(process.env.SSO_TOKEN_TTL_S) || undefined
    });
    bridge.server.listen(PORT, () => console.log(`[sso] bridge for ${bridge.issuer} listening on :${PORT}`));
}

if (require.main === module) main();
module.exports = { createBridge, loadClients, pkceOk };
