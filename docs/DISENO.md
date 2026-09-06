# Diseño — `dotrino-sso` (inicio de sesión único con la bóveda del usuario)

> **Estado:** el puente sigue **sin implementar**; la **fase 1 sí está hecha** — la prueba
> firmada con destinatario y vigencia vive en `@dotrino/identity` 0.83.0 (§4). Este
> documento fija el *qué* y el *cómo*, y deja marcadas las decisiones que faltan (§10).
>
> **Idioma/estilo:** español neutro (tuteo). Fuente de verdad del ecosistema:
> [`CLAUDE.md`](../../CLAUDE.md) y
> [`CONVENCIONES-APPS.md`](../../CONVENCIONES-APPS.md). El **código va en inglés**
> (§8.1 de convenciones): los identificadores de este documento ya lo están.

## 1. Propósito

Permitir que **una aplicación que no pertenece al ecosistema Dotrino** ofrezca
"Entrar con Dotrino", de modo que:

- el usuario se autentique **firmando con la llave de su bóveda**, que nunca sale
  de su dispositivo;
- el integrador use **OpenID Connect estándar**, sin aprender nada de Dotrino;
- el usuario **vea y decida** qué comparte con esa aplicación, y pueda **cortarle**
  el acceso después.

### Deslindes

- **No es `dotrino-vault`.** La bóveda es el proveedor de identidad: tiene la
  llave, muestra el permiso y firma. `dotrino-sso` no firma identidades ni podría.
- **No es `@dotrino/identity`.** El formato del sobre firmado vive en identity,
  junto a `signData` y a los sobres que ya usan proxio y reputación. Duplicarlo
  aquí obligaría a las apps a importar dos cosas para lo mismo.
- **No es `@dotrino/verifier`.** Respaldar un correo o una red es otro problema
  (un tercero firmante). El SSO **consume** ese respaldo, no lo produce.
- **No es un directorio de usuarios.** No hay tabla de cuentas, ni "olvidé mi
  contraseña", ni administración de altas y bajas.

## 2. Por qué el iframe compartido no basta

Dentro del ecosistema, la bóveda se expone como iframe (`id.dotrino.com`) y **ve
el origen** de cada mensaje: cuando `chess.dotrino.com` pide una firma, la bóveda
sabe que es ese origen y no otro, y no se puede falsificar. Con el filtro de
orígenes ya endurecido, entre apps propias el permiso explícito aportaría poca
cosa: sería ceremonia sobre aplicaciones del mismo dueño.

Lo que el iframe **no** resuelve, y este diseño sí:

1. **Sobres que salen del navegador.** La bóveda firma un sobre que viaja a
   proxio, a reputación o a geo. Esos servidores verifican **fuera** del iframe:
   no ven el origen, solo el sobre. La protección contra repetición evita que el
   mismo sobre se reenvíe dos veces, pero no que un sobre destinado a un servicio
   sirva **ante otro**. Falta decir **para quién** es cada sobre.
2. **Aplicaciones ajenas.** Ahí todo lo anterior deja de ser ceremonia: el permiso
   explícito, los alcances, el destinatario y la revocación son la diferencia
   entre "la bóveda de mis apps" y "un proveedor de identidad".

Conclusión de diseño: **el destinatario (`audience`) se añade siempre**, dentro y
fuera; **el permiso explícito solo se pide a orígenes externos** (§4.3).

## 3. Arquitectura

```
  ┌──────────────── dispositivo del usuario ────────────────┐
  │                                                          │
  │   bóveda (dotrino-vault)                                 │
  │   · llave privada (no extraíble, nunca sale)             │
  │   · pantalla de permiso + alcances concedidos por origen │
  │   · bitácora firmada                                     │
  │                    ▲                                     │
  └────────────────────┼─────────────────────────────────────┘
                       │  prueba firmada (assertion)
                       │  { sub, aud, nonce, exp, scopes, claims }
        ┌──────────────┴───────────────┬───────────────────────────┐
        │                              │                            │
  ┌─────▼──────────────┐     ┌─────────▼────────────┐    ┌──────────▼─────────┐
  │  app del ecosistema │     │  dotrino-sso (puente) │    │  app ajena con     │
  │  @dotrino/identity  │     │  OIDC hacia afuera    │    │  frontend propio   │
  │  verifica en cliente│     │  emite id_token (JWT) │    │  @dotrino/sso-client│
  └─────────────────────┘     └─────────┬─────────────┘    └────────────────────┘
                                        │ id_token estándar
                                  ┌─────▼──────┐
                                  │ backend de │
                                  │  un tercero│
                                  └────────────┘
```

Tres caminos, uno solo obligatorio (el primero):

| Camino | Quién lo usa | Intermediario |
|---|---|---|
| **Directo, en cliente** | Apps del ecosistema | ninguno |
| **Directo, con `@dotrino/sso-client`** | Tercero con frontend propio que verifica la prueba él mismo | ninguno |
| **Puente OIDC** | Tercero con backend clásico que quiere `id_token` | `dotrino-sso` |

## 4. La prueba firmada (*assertion*)

Vive en **`@dotrino/identity`**, no aquí. Este documento fija su forma porque el
puente depende de ella.

### 4.1. Forma

> **Implementado el 2026-09-05** en `@dotrino/identity` 0.83.0
> (`vault/assertion.js`, subpath `@dotrino/identity/assertion`). Lo que sigue describe lo
> que hay, con **una corrección respecto de la primera versión de este documento**: la
> prueba **no lleva `cert`**. El certificado es del protocolo aparato↔bóveda —autenticar
> peticiones—, no de atribuir contenido: quien dice qué llaves firman por una identidad es
> **el acta**, y lo que la prueba es la **cadena de actas** (`chain`), que ya viaja en
> cualquier firma del ecosistema. Arrastrar además un papel que no aporta nada era pedirle
> a cada prueba lo que ya resuelve `verifySignedBy`.

```jsonc
// cuerpo firmado por una llave que el acta del perfil autoriza a firmar
{
  "v":      1,
  "op":     "assertion",
  "sub":    "<profileId: la identidad, no la llave de este aparato>",
  "aud":    "https://app.ejemplo.com",          // PARA QUIÉN vale esta prueba
  "nonce":  "<reto de un solo uso, del que pide>",
  "iat":    1767000000,
  "exp":    1767000120,                          // corta: 2 min por defecto, tope 5
  "scopes": ["id:whoami", "profile:name"],
  "claims": { "name": "…" }                      // solo lo que los alcances permiten
}
// y junto a él, lo de siempre en una firma del ecosistema:
// { signature, publickey (quién firmó), chain (la cadena de actas que lo autoriza) }
```

Reglas:

- **`aud` es obligatorio.** Una prueba sin destinatario no se emite. Quien la
  recibe **debe** comprobar que `aud` es él; si no lo hace, es un fallo suyo, pero
  el formato ya no le da excusa.
- **`nonce` lo pone quien pide**, y solo acepta la prueba que lo lleve: eso ata la
  prueba a *esta* sesión de inicio y no a otra.
- **`exp` corto** (minutos). Es lo que hace barata la revocación: no hay nada que
  invalidar, solo se deja de renovar.
- **`chain`** encadena la firma hasta el génesis del perfil, de modo que quien verifica
  comprueba que ese aparato firma por esa identidad sin conocerlo de antemano. Y `sub`
  tiene que coincidir con el `profileId` que sale de la cadena: si no, la prueba diría la
  verdad sobre quién la firmó y una mentira sobre de quién es.
- **El tope de vigencia lo comprueba también quien recibe.** Fiarse del `exp` que puso el
  emisor es fiarse de su buena fe, y una prueba de un año es una credencial al portador.

### 4.2. API (en `@dotrino/identity`)

```ts
// lado que pide (necesita la bóveda: firma)
id.requestAssertion({ audience, nonce, scopes?, ttlMs? }): Promise<Assertion>
// lado que recibe (módulo PURO: ni iframe ni llaves — lo importa un servidor)
verifyAssertion(assertion, { audience, nonce, expectedProfileId?, now? }): Promise<VerifiedAssertion>
// y el reto lo genera quien pide:
newAssertionNonce(): string
```

`verifyAssertion` falla si el destinatario no coincide, si el reto no coincide, si
expiró, si la cadena del certificado no cierra o si la firma no valida. **Sin
excepciones ni modo permisivo**: un verificador laxo es un verificador roto.

### 4.3. Alcances (*scopes*)

Mismo patrón que los secretos de servicio (`vault:secrets:<ns>`), aplicado a
identidad:

| Alcance | Qué concede |
|---|---|
| `id:whoami` | Solo el identificador (`sub`). El mínimo; no revela nada más. |
| `profile:name` | Nombre visible |
| `profile:avatar` | Foto o identicón |
| `profile:email` | Correo (con su respaldo, si lo tiene — §7) |
| `profile:social` | Redes y enlaces declarados |

Quien pide, pide **lo mínimo**. La bóveda nunca añade lo que no se pidió.

### 4.4. Permiso explícito, según de dónde venga

| Origen | Comportamiento |
|---|---|
| **Del ecosistema** (lista de apps conocidas) | Concedido de forma implícita para `id:whoami`; se pide permiso solo si el alcance es sensible (`profile:email`). No se molesta al usuario treinta veces por aplicaciones del mismo dueño. |
| **Externo** | **Siempre** pantalla de permiso la primera vez: *"«Tal aplicación» quiere saber quién eres y ver tu nombre"* → **Permitir** / **Solo esta vez** / **No**. Lo concedido se guarda por origen y se puede retirar. |

Esta distinción es la que evita que el permiso sea ceremonia dentro y sea real
fuera.

## 5. El puente OpenID Connect

### 5.1. Lo que expone

Un proveedor OIDC corriente, sin nada raro:

```
GET  /.well-known/openid-configuration
GET  /authorize      → inicia el flujo (Authorization Code + PKCE)
POST /token          → { id_token, access_token?, expires_in }
GET  /jwks.json      → llaves públicas con las que firma el puente
GET  /userinfo       → los datos consentidos
```

Se soporta **solo** *Authorization Code con PKCE*. Nada de flujo implícito ni de
credenciales de contraseña: no hay contraseña que dar.

### 5.2. Lo que pasa por dentro

1. La aplicación manda al usuario a `/authorize` con su `client_id`, su
   `redirect_uri` y su `code_challenge`.
2. El puente sirve una página mínima que **habla con la bóveda del usuario** y le
   pide una prueba con `audience` = el propio puente y un `nonce` propio.
3. La bóveda muestra el permiso (origen externo → siempre) y firma.
4. El puente **verifica** la prueba: cadena del certificado, destinatario, reto,
   vigencia.
5. Emite un `code`; en `/token` lo canjea por un `id_token` **firmado por el
   puente** con `sub` = la llave pública del usuario y los `claims` consentidos.
6. **Olvida.** Lo único que queda es el `code` en memoria hasta que se canjea o
   expira (segundos).

### 5.3. Qué guarda y qué no

| Guarda | No guarda |
|---|---|
| Las aplicaciones registradas (`client_id`, nombre, URLs de retorno) | Usuarios: ninguna tabla de cuentas |
| Sus propias llaves de firma | Llaves ni datos del usuario |
| Códigos en vuelo, en memoria, con vencimiento de segundos | Historial de accesos, correos, direcciones IP |

**Sin base de datos de usuarios** no es un detalle de implementación: es lo que
hace que un compromiso del puente no filtre un directorio de nadie.

### 5.4. Registro de aplicaciones

Un tercero registra su aplicación (nombre, logo, URLs de retorno) y recibe un
`client_id`. Ese nombre y ese logo son los que el usuario ve en la pantalla de
permiso — por eso el registro existe: para que el permiso diga *"Tal aplicación"* y
no una dirección cruda, y para que un origen desconocido se vea **como
desconocido**.

Cómo se registra (formulario, fichero declarativo, autorregistro) está sin
decidir — §10.

## 6. Autohospedaje

El puente se levanta con un contenedor y su propio dominio:

```
sso.tuempresa.com   ← el mismo código, en tu red, sin nada de Dotrino corriendo
```

Es **el** caso de la línea de empresa: los empleados entran a las herramientas
internas sin contraseñas, con la llave en cada portátil y el servicio de inicio de
sesión en su propia sala. *Nada que no deba salir sale.*

De ahí sale también una restricción de arquitectura: por eso el puente es un
repositorio y un servicio **aparte** y no vive dentro de `dotrino-vault`. Si
viviera dentro, "levántalo tú solo" dejaría de ser cierto.

## 7. Límites honestos

Se dicen en voz alta, en la documentación pública y en el `README`, en vez de
esconderse:

- **Una firma prueba continuidad, no identidad.** Prueba que es la misma persona
  que la vez pasada. No prueba que se llame como dice. Quien necesite un nombre
  real necesita además un respaldo ([`@dotrino/verifier`](../../dotrino-verifier/)).
- **El correo no viene respaldado por omisión.** Un integrador que use el correo
  como clave primaria de su tabla debe saberlo. Mientras el verificador no esté
  cableado, `profile:email` entrega un correo **declarado**.
- **No reemplaza a un proveedor de identidad masivo** en una tienda cualquiera.
  El integrador realista de la primera hora es quien ya valora la privacidad, o
  una empresa que autohospeda.
- **Si se pierde el master del perfil, se pierde la cuenta.** Es el modelo de la
  bóveda y aquí no cambia. No hay recuperación por correo, porque no hay nadie
  que la pueda dar.
- **Usar el puente alojado por Dotrino revela en qué aplicaciones entras**, a
  Dotrino. Los caminos directos (§3) no.

## 8. Privacidad, y por qué esto no contradice el posicionamiento

- La llave **nunca** sale del dispositivo, ni pasa por el puente.
- El puente **no persiste** accesos, así que no hay historial que pedirle ni que
  filtrar.
- Los datos que viajan son **los que el usuario concedió**, uno por uno.
- **El mismo usuario en dos aplicaciones no queda correlacionado** por ninguna
  base de datos central: si algún día se quiere evitar incluso que dos
  aplicaciones puedan cruzar el `sub`, el camino es un identificador **por pares**
  (derivado de `sub` + `client_id`), a costa de que la misma persona no sea
  reconocible entre servicios. Decisión pendiente (§10).
- Nada de terceros: ni analítica ajena, ni recursos externos en la pantalla de
  permiso.

## 9. Revocación y "dónde se usó mi identidad"

Vive en [`dotrino-profile-app`](../../dotrino-profile-app/), no aquí: es la consola
del usuario.

- Lista de aplicaciones que usan su identidad, con último uso y alcances
  concedidos.
- **Retirar** el permiso de una aplicación: deja de firmarse para ese
  destinatario, y como las pruebas duran minutos, el corte es efectivo enseguida
  sin necesidad de avisar a nadie.
- Solo tiene sentido cuando hay terceros a los que retirar el permiso: por eso va
  después del puente y no antes.

## 10. Decisiones pendientes

| Tema | Pregunta |
|---|---|
| **Registro de aplicaciones** | ¿Autorregistro abierto, fichero declarativo revisado o alta manual? Abierto es cómodo y permite que cualquiera se anuncie con el nombre que quiera en la pantalla de permiso. |
| **Identificador por pares** | ¿`sub` igual en todas las aplicaciones (la misma persona es reconocible) o derivado por aplicación (nadie puede cruzarlas)? Son objetivos incompatibles; hay que elegir, o dejarlo a elección del usuario por aplicación. |
| **Correo respaldado** | ¿Se bloquea `profile:email` hasta que `@dotrino/verifier` esté cableado, o se entrega marcado como *declarado*? |
| **Bóveda ausente** | Si el usuario no tiene bóveda instalada, ¿la pantalla del puente ofrece crear un perfil ahí mismo, o manda a `profile.dotrino.com`? |
| **Cierre de sesión global** | OIDC define avisar a las aplicaciones al cerrar sesión, y eso exige que el puente sepa **dónde** entraste — justo lo que decidimos no guardar. Probable respuesta: no se soporta, y se explica por qué. |
| **Salir del navegador** | El flujo asume una bóveda alcanzable desde la página del puente (iframe o daemon local). Falta definir el caso del móvil sin bóveda local. |

## 11. Referencias

- [`CLAUDE.md`](../../CLAUDE.md) — posicionamiento, reglas de privacidad y de
  redacción del ecosistema.
- [`CONVENCIONES-APPS.md`](../../CONVENCIONES-APPS.md) — §1.2 (landing de un
  servicio), §8.1 (el código va en inglés), §9.1 (lenguaje llano).
- [`dotrino-vault/docs/`](../../dotrino-vault/docs/) — modelo del acta,
  certificados de dispositivo y bitácora, sobre los que esto se apoya.
