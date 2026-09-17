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

**El `name` tiene que ser único.** La bóveda del usuario guarda lo que le concede a cada
aplicación por el origen del puente **más** ese nombre (`@dotrino/identity` ≥ 0.93.0): dos
aplicaciones registradas con el mismo nombre compartirían el permiso, y el usuario tampoco
podría distinguirlas en el panel. Cambiarle el nombre a una hace que se le vuelva a preguntar.

## Qué guarda

Su llave de firma y el fichero de aplicaciones. **Nada más**: ni usuarios, ni accesos, ni
direcciones IP. Los códigos viven en memoria y vencen en un minuto. Por eso un compromiso de
este servicio no filtra el directorio de nadie — obliga a rotar la llave y poco más.

**Eso vale para el proceso, y el servidor web de delante tiene que cumplirlo también.** Un
nginx con la configuración por defecto anota cada petición con su IP y su hora, y la de
`/authorize` lleva el `client_id`: o sea, quién entró a qué aplicación y cuándo, que es
justo lo que aquí se promete no guardar. Pasó en el de Dotrino hasta el 2026-09-17. En el
sitio del puente:

```nginx
server {
    server_name sso.tuempresa.com;
    access_log off;
    ...
}
```

(en los dos bloques, el de 443 y el de 80). El `error_log` se queda: solo escribe cuando el
servidor falla —el puente caído, por ejemplo— y entonces sí anota la petición que falló.

## Cómo está desplegado el de Dotrino (2026-09-06)

En el VPS **74.208.11.221**, el mismo que sirve geo y reputación:

```
~/dotrino-sso            clon del repo (https, es público)
~/cc-sso.config.cjs      pm2: PORT 8093, SSO_ISSUER, rutas de llave y clientes
~/.dotrino-sso/          la llave de firma (600) y clients.json
nginx: /etc/nginx/sites-available/sso.dotrino.com → 127.0.0.1:8093, con access_log off
```

```bash
pm2 start ~/cc-sso.config.cjs --update-env && pm2 save
```

DNS: registro **A → 74.208.11.221 en DNS only (gris)**, igual que `geo.dotrino.com` — con la
nube naranja, Cloudflare vería cada acceso. Certificado propio (`certbot --nginx -d
sso.dotrino.com`).

## Autohospedarlo

Es el caso de la línea de empresa: `sso.tuempresa.com`, el mismo código, en tu red, sin nada
de Dotrino corriendo. Dos avisos honestos:

- El **iframe de identidad** que use la página de `/authorize` tiene que aceptar tu origen.
  El de Dotrino (`id.dotrino.com`) solo habla con `*.dotrino.com`, así que un puente en otro
  dominio necesita su propia bóveda (`SSO_VAULT_URL`).
- Quien use el puente **alojado por Dotrino** le está diciendo a Dotrino en qué aplicaciones
  entra. Los caminos directos (`@dotrino/sso-client`) no.
