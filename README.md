# dotrino-sso

**Un solo inicio de sesión para todo, sin contraseñas y sin que tu llave salga de
tu equipo.**

`dotrino-sso` es el **puente** entre la identidad de Dotrino (tu bóveda personal,
que guarda tu llave y firma por ti) y el resto del mundo: cualquier aplicación
—aunque no sea del ecosistema— puede ofrecer *"Entrar con Dotrino"* usando el
protocolo estándar que ya sabe hablar (**OpenID Connect**), sin enterarse de cómo
funciona Dotrino por dentro.

Parte del ecosistema [Dotrino](https://dotrino.com/) · MIT.

> **Estado: diseño, sin implementar.** Este repo contiene por ahora solo la
> documentación. El diseño completo está en [`docs/DISENO.md`](./docs/DISENO.md);
> el reparto de trabajo entre piezas, en
> [`docs/FASES.md`](./docs/FASES.md).

---

## 1. La idea en una línea

> **La bóveda del usuario es el proveedor de identidad. `dotrino-sso` es el
> traductor a OpenID Connect para el mundo de fuera.**

La llave **nunca** sale del dispositivo del usuario y **nunca** pasa por este
servicio. Lo que este servicio hace es comprobar una prueba firmada por esa llave
y traducirla al formato que espera una aplicación cualquiera.

## 2. Qué es y qué NO es

| | |
|---|---|
| **Es** | Un servicio (servidor) que habla OpenID Connect hacia afuera y el protocolo de la bóveda hacia adentro. |
| **Es** | **Autohospedable**: una empresa lo levanta en su propia red y no necesita nada de Dotrino corriendo. |
| **No es** | Un certificador. **No firma identidades**: eso solo lo hace la bóveda del usuario ([`dotrino-vault`](../dotrino-vault/)). |
| **No es** | Una base de datos de usuarios. No guarda cuentas, ni contraseñas, ni historial de accesos. |
| **No es** | Obligatorio. Una aplicación con frontend propio puede verificar la prueba firmada por su cuenta, sin pasar por aquí. |

## 3. Por qué existe (y qué se pierde)

Dentro del ecosistema no hace falta: las apps de Dotrino usan
[`@dotrino/identity`](../dotrino-identity/) y hablan con la bóveda directamente.

El problema aparece **fuera**: quien integra un botón de "entrar con…" tiene un
backend en Rails, Django o Node y espera un flujo OpenID Connect con un `id_token`
verificable. No va a integrar un protocolo propio; el listón real es *"veinte
líneas y funciona"*.

El compromiso, dicho en voz alta en vez de escondido: **este puente es un tercero
de confianza.** No ve la llave del usuario ni su contenido, pero sí ve **en qué
aplicación entra**. Es exactamente el rol que el ecosistema evita por diseño, y por
eso el diseño lo acota con tres reglas duras:

1. **Se puede autohospedar.** MIT, un contenedor, `sso.tuempresa.com`. Quien usa el
   nuestro es quien no quiere montar el suyo.
2. **No guarda nada.** Recibe la prueba, la verifica, emite el token y olvida. Sin
   base de datos de accesos.
3. **Hay camino directo.** Quien no quiera intermediario verifica la prueba en el
   cliente con `@dotrino/sso-client`, y este servicio no participa.

## 4. Cómo se ve para quien integra

Como cualquier otro proveedor de identidad. La librería OpenID Connect del
lenguaje que sea, apuntada a:

```
https://sso.dotrino.com/.well-known/openid-configuration
```

Lo que cambia respecto de un proveedor clásico está en el detalle, y conviene
saberlo antes de integrar:

- **No hay contraseña.** El usuario aprueba desde su bóveda; nadie escribe una
  credencial en ningún sitio.
- **El identificador de usuario (`sub`) es su llave pública**, no un correo. El
  correo puede venir, pero solo si el usuario lo comparte y —cuando la
  verificación esté cableada— si alguien lo respalda.
- **La misma persona es la misma en todas las aplicaciones** que use, sin que
  ninguna base de datos central las relacione.

Los límites honestos de esto (qué prueba y qué no prueba una firma) están en
[`docs/DISENO.md` §7](./docs/DISENO.md).

## 5. Piezas relacionadas

| Pieza | Papel |
|---|---|
| [`dotrino-vault`](../dotrino-vault/) | **El proveedor de identidad real.** Guarda la llave, muestra el permiso al usuario y firma la prueba. |
| [`@dotrino/identity`](../dotrino-identity/) | El formato de la prueba firmada (`requestAssertion` / `verifyAssertion`) y el acceso a la bóveda desde el navegador. |
| `dotrino-sso` (este repo) | El traductor a OpenID Connect para aplicaciones de fuera. |
| `@dotrino/sso-client` (este repo) | Verificar la prueba **sin** intermediario, para quien tiene frontend propio. |
| [`dotrino-profile-app`](../dotrino-profile-app/) | Donde el usuario ve **dónde se usó su identidad** y corta el acceso de una aplicación. |
| [`@dotrino/verifier`](../dotrino-verifier/) | Respaldo de correo/redes por terceros firmantes. Es lo que convierte un correo *declarado* en un correo *respaldado*. |
| [`dotrino-ad-integration`](../dotrino-ad-integration/) | **El camino inverso**: la empresa (Active Directory) respalda al usuario, y Dotrino confía en ella. Aquí es Dotrino quien respalda al usuario ante terceros. |

## 6. Documentación

- [`docs/DISENO.md`](./docs/DISENO.md) — el diseño: formato de la prueba firmada,
  permisos y alcances, mapeo a OpenID Connect, qué guarda y qué no el puente,
  autohospedaje, y los límites honestos.
- [`docs/FASES.md`](./docs/FASES.md) — qué se construye, en qué orden y en qué
  repo cae cada cosa.
