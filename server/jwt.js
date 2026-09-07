'use strict';

/**
 * JWT ES256 a mano, con `node:crypto` y nada más.
 *
 * No es por purismo: este servicio se autohospeda y cuanto menos traiga, menos hay que
 * mirar cuando alguien lo levanta en su red. Un JWT firmado son tres trozos en base64url y
 * una firma P-256 — la misma curva que usa toda la identidad del ecosistema, así que no se
 * introduce cripto nueva.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlJson = (obj) => b64url(Buffer.from(JSON.stringify(obj), 'utf8'));

/**
 * La llave con la que firma ESTE puente. Se genera una vez y se guarda en disco.
 *
 * Es lo ÚNICO que el puente custodia: no hay llaves de usuario aquí, y por eso un
 * compromiso de este servicio no filtra un directorio de nadie — solo obliga a rotar esto.
 */
function loadOrCreateKey(file) {
    if (fs.existsSync(file)) {
        const pem = fs.readFileSync(file, 'utf8');
        return crypto.createPrivateKey(pem);
    }
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, pem, { mode: 0o600 });
    return privateKey;
}

/** El `kid`: huella de la pública, para que quien verifique sepa cuál de las llaves usar. */
function keyId(privateKey) {
    const jwk = crypto.createPublicKey(privateKey).export({ format: 'jwk' });
    return crypto.createHash('sha256').update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })).digest('hex').slice(0, 16);
}

/** El JWKS que se publica: solo la parte pública, nunca la otra. */
function jwks(privateKey) {
    const jwk = crypto.createPublicKey(privateKey).export({ format: 'jwk' });
    return { keys: [{ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, use: 'sig', alg: 'ES256', kid: keyId(privateKey) }] };
}

/** Firma un `id_token`. La firma va en formato P1363 (r||s), que es lo que pide JOSE. */
function signJwt(payload, privateKey) {
    const header = { alg: 'ES256', typ: 'JWT', kid: keyId(privateKey) };
    const data = b64urlJson(header) + '.' + b64urlJson(payload);
    const sig = crypto.sign('sha256', Buffer.from(data, 'utf8'), { key: privateKey, dsaEncoding: 'ieee-p1363' });
    return data + '.' + b64url(sig);
}

/** Verificar el propio token, que es lo que hacen los tests y quien integre sin librería. */
function verifyJwt(token, publicKeyLike) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;
    // Se acepta tanto una pública ya hecha como la privada (de ella se saca). Pasarle una
    // pública a `createPublicKey` revienta, y eso convertía un uso razonable en un error
    // feo en vez de en lo que se espera.
    const key = (publicKeyLike && publicKeyLike.type === 'public')
        ? publicKeyLike
        : crypto.createPublicKey(publicKeyLike);
    const ok = crypto.verify('sha256', Buffer.from(h + '.' + p, 'utf8'),
        { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
    if (!ok) return null;
    try { return JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); }
    catch (_) { return null; }
}

module.exports = { b64url, loadOrCreateKey, keyId, jwks, signJwt, verifyJwt };
