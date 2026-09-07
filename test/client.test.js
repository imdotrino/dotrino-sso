/**
 * El camino DIRECTO: quien tiene frontend propio no necesita el puente para nada — pide la
 * prueba a la bóveda y la verifica él mismo. Y eso importa por algo concreto: el puente,
 * por bueno que sea, ve en qué aplicación entras. Por aquí no lo ve nadie.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Identity } from '@dotrino/identity/node'
import { verifyLogin, newAssertionNonce } from '../src/index.js'

const MI_APP = 'https://app.ejemplo.com'
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ssoc-'))

async function cuenta () {
  const dir = tmp()
  const id = await Identity.connect({ dir })
  const profileId = (await id.profileActa())?.acta?.profileId || id.me.publickey
  return { id, profileId, limpia: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

test('quien entra es la misma persona en todas tus pantallas, y sin nadie en medio', async () => {
  const c = await cuenta()
  const nonce = newAssertionNonce()
  const prueba = await c.id.requestAssertion({ audience: MI_APP, nonce, scopes: ['id:whoami'] })

  const v = await verifyLogin(prueba, { audience: MI_APP, nonce })
  assert.equal(v.ok, true, v.reason)
  assert.equal(v.profileId, c.profileId)
  assert.ok(v.expiresAt > Date.now())
  c.limpia()
})

test('la prueba de otra aplicación no sirve en la mía', async () => {
  const c = await cuenta()
  const nonce = newAssertionNonce()
  const prueba = await c.id.requestAssertion({ audience: 'https://otra.ejemplo.com', nonce, scopes: ['id:whoami'] })
  const v = await verifyLogin(prueba, { audience: MI_APP, nonce })
  assert.equal(v.ok, false)
  assert.equal(v.reason, 'otro-destinatario')
  c.limpia()
})

test('sin decir quién eres tú, o con otro reto, no se juzga', async () => {
  const c = await cuenta()
  const nonce = newAssertionNonce()
  const prueba = await c.id.requestAssertion({ audience: MI_APP, nonce, scopes: ['id:whoami'] })
  assert.equal((await verifyLogin(prueba, { nonce })).reason, 'no-audience')
  assert.equal((await verifyLogin(prueba, { audience: MI_APP, nonce: 'otro' })).reason, 'otro-reto')
  c.limpia()
})
