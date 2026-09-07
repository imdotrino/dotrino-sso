/**
 * @dotrino/sso-client — «Entrar con Dotrino» SIN intermediario.
 *
 * El puente OIDC existe para quien tiene un backend clásico y quiere un `id_token`. Quien
 * tenga frontend propio no lo necesita para nada: pide la prueba a la bóveda del usuario y
 * la verifica él mismo. Este paquete es esa media docena de líneas, para que integrarlo
 * cueste menos que copiar el fragmento de un proveedor grande.
 *
 * Y el que no participe nadie más no es un detalle: el puente, por bueno que sea, VE en qué
 * aplicación entras. Por aquí no lo ve nadie.
 */
import { verifyAssertion, newAssertionNonce } from '@dotrino/identity/assertion'

export { newAssertionNonce }

/**
 * ¿Quién es quien me manda esta prueba?
 *
 * `audience` eres TÚ (la URL de tu aplicación) y `nonce` es el reto que mandaste: los dos
 * son obligatorios, y sin ellos no hay nada que comparar. Devuelve `{ ok, profileId,
 * claims }` — `profileId` es el identificador estable del usuario, el mismo en todas tus
 * pantallas y sin ninguna base de datos central que los relacione.
 */
export async function verifyLogin (assertion, { audience, nonce, now } = {}) {
  const v = await verifyAssertion(assertion, { audience, nonce, now })
  if (!v.ok) return { ok: false, reason: v.reason }
  return {
    ok: true,
    profileId: v.profileId,     // el «sub»: quién es, de forma estable
    claims: v.claims || {},     // solo lo que el usuario haya concedido
    scopes: v.scopes || [],
    expiresAt: v.exp
  }
}

/**
 * Lo que hay que pedirle a la bóveda desde el navegador. Se deja aquí para que las dos
 * mitades —lo que se pide y lo que se comprueba— salgan del mismo sitio y no se separen.
 *
 * ```js
 * const nonce = newAssertionNonce()                       // guárdalo en la sesión
 * const prueba = await id.requestAssertion({ audience: location.origin, nonce, scopes })
 * // …mándalo a tu backend y allí: verifyLogin(prueba, { audience, nonce })
 * ```
 */
export const LOGIN_SCOPES = Object.freeze(['id:whoami'])

export default { verifyLogin, newAssertionNonce, LOGIN_SCOPES }
