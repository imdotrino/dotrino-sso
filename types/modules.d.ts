// Subpaths de pilares que no publican tipos propios. Lo que hay aquí es solo lo que usa
// este repo, con la forma que documenta cada pilar.

declare module '@dotrino/identity/assertion' {
  export type AssertionResult =
    | { ok: true, profileId: string, signer: string, seq: number, scopes: string[], claims: Record<string, unknown>, aud: string, exp: number }
    | { ok: false, reason: string }
  export function verifyAssertion(
    assertion: unknown,
    opts?: { audience?: string, nonce?: string, expectedProfileId?: string | null, now?: number, maxSkewMs?: number }
  ): Promise<AssertionResult>
  export function newAssertionNonce(): string
}

declare module '@dotrino/identity/keyid' {
  /** La huella corta y estable de una pública (JWK serializado). */
  export function pubkeyId(publicJwkStr: string): Promise<string>
}

declare module '@dotrino/update/deps' {
  export function watchDependencies(opts: { dir: string, name?: string, match?: unknown, log?: (line: string) => void, onNewer?: (...args: unknown[]) => void }): unknown
}
