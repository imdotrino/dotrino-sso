# Deploy — `sso.dotrino.com`

Servicio Node **sin dependencias de runtime** salvo el pilar de identidad. Corre detrás del
reverse proxy que termina TLS, como el resto.

```bash
cd server
npm install
SSO_ISSUER=https://sso.dotrino.com npm start     # escucha en :8093
```

## Variables

| Var | Default | Descripción |
|-----|---------|-------------|
| `PORT` | `8093` | puerto HTTP |
| `SSO_ISSUER` | **sin valor: no arranca** | la URL pública de ESTE puente. Es el `issuer` de OIDC **y** el destinatario de las pruebas, que va firmado dentro de ellas: adivinarlo sería aceptar pruebas dirigidas a otro. |
| `SSO_KEY_FILE` | `~/.dotrino-sso/signing-key.pem` | la llave con la que firma los `id_token`. Se genera sola la primera vez, en modo 600. Es lo **único** que este servicio custodia. |
| `SSO_CLIENTS_FILE` | `server/clients.json` | las aplicaciones registradas (ver abajo) |
| `SSO_VAULT_URL` | `https://id.dotrino.com/` | de dónde sale el iframe de identidad |
| `SSO_CODE_TTL_MS` | `60000` | vida de un `code`. Segundos: se canjea de inmediato o no vale |
| `SSO_TOKEN_TTL_S` | `600` | vida del `id_token` |

## Registrar una aplicación

`clients.json`, fichero declarativo y revisado — **no autorregistro abierto**: el nombre que
se pone aquí es el que el usuario ve, y dejar que cualquiera se anuncie con el nombre que
quiera es regalar la mitad de un engaño.

```json
{
  "app-de-ejemplo": {
    "client_id": "app-de-ejemplo",
    "name": "App de ejemplo",
    "redirect_uris": ["https://app.ejemplo.com/callback"]
  }
}
```

La URL de retorno se compara **entera**: un prefijo dejaría colar `?next=` y con eso el
código se va a otra parte.

## Qué guarda

Su llave de firma y el fichero de aplicaciones. **Nada más**: ni usuarios, ni accesos, ni
direcciones IP. Los códigos viven en memoria y vencen en un minuto. Por eso un compromiso de
este servicio no filtra el directorio de nadie — obliga a rotar la llave y poco más.

## Autohospedarlo

Es el caso de la línea de empresa: `sso.tuempresa.com`, el mismo código, en tu red, sin nada
de Dotrino corriendo. Dos avisos honestos:

- El **iframe de identidad** que use la página de `/authorize` tiene que aceptar tu origen.
  El de Dotrino (`id.dotrino.com`) solo habla con `*.dotrino.com`, así que un puente en otro
  dominio necesita su propia bóveda (`SSO_VAULT_URL`).
- Quien use el puente **alojado por Dotrino** le está diciendo a Dotrino en qué aplicaciones
  entra. Los caminos directos (`@dotrino/sso-client`) no.
