# Fases — qué se construye, en qué orden y en qué repo

> Complementa a [`DISENO.md`](./DISENO.md). Estado: **nada implementado**.

## Orden acordado con el dueño (2026-09-05)

Las fases de aquí siguen valiendo tal cual, pero **no son las primeras de la cola**.
El dueño fijó tres direcciones y este orden exacto:

| | Qué | Dónde está descrito |
|---|---|---|
| 1 | **Entrar en un aparato nuevo** (sesiones del propio ecosistema) | [`dotrino-vault/docs/inicio-de-sesion.md`](../../dotrino-vault/docs/inicio-de-sesion.md) |
| 2 | **"Entrar con Dotrino"** en aplicaciones ajenas | este documento |
| 3 | **Entrar a Dotrino con Microsoft / Active Directory** | [`dotrino-ad-integration`](../../dotrino-ad-integration/) |

Encaja sin tocar nada de lo de abajo: la **fase 1** (destinatario y vigencia en el
sobre) es la misma pieza para las tres, y la **fase 2** (alcances y permiso por
origen) es la misma pantalla. Lo que se intercala es el **login del ecosistema**
entre la fase 2 y la 3, porque produce el concepto que aquí faltaba —una sesión con
vencimiento que se puede cerrar— y porque la fase 4 («dónde se usó mi identidad»)
debe listar **sesiones y aplicaciones ajenas en una sola pantalla**, no en dos.

## Corrección de partida

La primera versión de este plan separaba "una fase interna para el ecosistema" y
"una fase externa para terceros". **Es un orden equivocado.** El permiso explícito,
los alcances y la revocación casi no pagan dentro del ecosistema (todas las apps
son del mismo dueño y la bóveda ya ve el origen de cada petición): **son
precisamente lo que hace falta para las aplicaciones ajenas**. Así que el orden va
por el objetivo, no por una preparación que dentro no se nota.

Lo único de la lista que además arregla algo real hoy es el **destinatario en el
sobre** (fase 1).

## Fase 1 — destinatario y vigencia en el sobre firmado

**Repo:** `dotrino-identity` (+ `dotrino-vault`)

- `requestAssertion({ audience, nonce, scopes })` y `verifyAssertion()`.
- `aud`, `nonce`, `iat`, `exp` obligatorios; sin modo permisivo al verificar.
- Cadena al certificado de dispositivo del acta.

**Por qué primero:** sin destinatario no hay nada más — ni permiso con sentido, ni
puente, porque un sobre sin `aud` es reutilizable ante otro servicio. Y de rebote
cierra el cruce de destinatario entre proxio, geo y reputación, que hoy está
abierto (la protección contra repetición evita el reenvío, no el cruce).

**Riesgo:** toca el pilar que usan todas las apps. Cambio limpio en los dos lados
y se publica, sin capa de compatibilidad (fase de desarrollo del ecosistema).

## Fase 2 — alcances y permiso explícito

**Repo:** `dotrino-vault`

- Alcances `id:whoami`, `profile:name`, `profile:avatar`, `profile:email`,
  `profile:social`.
- Pantalla de permiso, **diseñada para el caso ajeno desde el principio**: origen
  del ecosistema → concedido implícitamente para lo básico; origen externo →
  siempre se pregunta.
- Lo concedido se guarda por origen y se puede retirar.
- Lista de aplicaciones conocidas (nombre y logo) para que el permiso no muestre
  una dirección cruda.

## Fase 3 — el puente OpenID Connect

**Repo:** `dotrino-sso` (este) → `sso.dotrino.com`

- `/.well-known/openid-configuration`, `/authorize`, `/token`, `/jwks.json`,
  `/userinfo`. Solo *Authorization Code* con PKCE.
- Verifica la prueba de la bóveda y emite `id_token`.
- Sin base de datos de usuarios; códigos en memoria con vencimiento de segundos.
- Contenedor autohospedable.
- **`@dotrino/sso-client`**: verificar la prueba sin intermediario, para quien
  tiene frontend propio. Debe ser corto de verdad — si integrarlo cuesta más que
  copiar el fragmento de un proveedor grande, no lo integra nadie.

Con las fases 1 y 2 hechas, el puente es una capa fina: recibe, verifica, emite.

## Fase 4 — dónde se usó mi identidad

**Repo:** `dotrino-profile-app`

- Aplicaciones que usan la identidad, último uso y alcances concedidos.
- Retirar el permiso de una. Con pruebas de minutos, el corte es inmediato.

Va al final porque solo tiene sentido cuando hay terceros a los que retirar el
permiso.

## Fase 5 — presentación pública

**Repos:** `dotrino-sso/web/`, `dotrino-home`

- Landing explicativa del servicio según
  [`CONVENCIONES-APPS.md` §1.2](../../CONVENCIONES-APPS.md): estática, sin PWA,
  con la barra superior estándar, bilingüe, SEO y analítica del ecosistema.
- **Lenguaje llano** (§9.1): "SSO" es argot y no aparece de cara al público. Se
  dice *"un solo inicio de sesión para todo"*. El término técnico se queda en el
  repositorio y en la documentación para desarrolladores.
- Alta en el catálogo (`dotrino-home/src/data/apps.ts`, categoría `developers`).
- La página **advierte** lo que el puente ve (en qué aplicación entras) y ofrece
  el camino directo y el autohospedaje como alternativa.

## Qué NO se hace

- **Flujo implícito ni contraseñas.** No hay contraseña que dar.
- **Cobrar por el puente alojado.** Crearía un incentivo para que la gente no lo
  autohospede, y ese incentivo se acaba notando en el producto.
- **Prometer que sustituye a un proveedor de identidad masivo.** Mientras el
  correo no venga respaldado, es otra cosa: un inicio de sesión para quien valora
  la privacidad, y un SSO interno para una empresa.
