// A software passkey authenticator for tests only: makes P-256 credentials with "none" attestation and signs
// sign-in challenges the way a phone or Windows Hello would. `uv: false` simulates skipping the fingerprint/PIN.
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import type {
  AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON,
} from '@simplewebauthn/server';

const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest();
type CBOR = Parameters<typeof isoCBOR.encode>[0];
const UP = 0x01, UV = 0x04, AT = 0x40;

interface Credential { id: Buffer; privateKey: KeyObject; userHandle: string; counter: number }

export class SoftAuthenticator {
  readonly credentials: Credential[] = [];

  private authData(rpID: string, flags: number, counter: number, attested?: Buffer) {
    const c = Buffer.alloc(4);
    c.writeUInt32BE(counter);
    return Buffer.concat([sha256(rpID), Buffer.from([flags]), c, ...(attested ? [attested] : [])]);
  }

  register(options: PublicKeyCredentialCreationOptionsJSON, origin: string, opts: { uv?: boolean } = {}): RegistrationResponseJSON {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const cose = isoCBOR.encode(new Map<number, CBOR>([
      [1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, 'base64url')], [-3, Buffer.from(jwk.y!, 'base64url')],
    ]));
    const id = randomBytes(32);
    const len = Buffer.alloc(2);
    len.writeUInt16BE(id.length);
    const attested = Buffer.concat([Buffer.alloc(16), len, id, Buffer.from(cose)]);
    const flags = UP | AT | (opts.uv === false ? 0 : UV);
    const authData = this.authData(options.rp.id!, flags, 0, attested);
    const attestationObject = isoCBOR.encode(new Map<string, CBOR>([
      ['fmt', 'none'], ['attStmt', new Map<string, CBOR>()], ['authData', authData],
    ]));
    const clientDataJSON = JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false });
    this.credentials.push({ id, privateKey, userHandle: options.user.id, counter: 0 });
    return {
      id: b64url(id), rawId: b64url(id), type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {},
      response: { clientDataJSON: b64url(Buffer.from(clientDataJSON)), attestationObject: b64url(attestationObject), transports: ['internal'] },
    };
  }

  assert(options: PublicKeyCredentialRequestOptionsJSON, origin: string, opts: { uv?: boolean; counter?: number; credentialIndex?: number } = {}): AuthenticationResponseJSON {
    const cred = this.credentials[opts.credentialIndex ?? this.credentials.length - 1];
    if (!cred) throw new Error('SoftAuthenticator has no passkey; register one first.');
    cred.counter = opts.counter ?? cred.counter + 1;
    const authData = this.authData(options.rpId!, UP | (opts.uv === false ? 0 : UV), cred.counter);
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin, crossOrigin: false }));
    const signature = sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), cred.privateKey);
    return {
      id: b64url(cred.id), rawId: b64url(cred.id), type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {},
      response: { clientDataJSON: b64url(clientDataJSON), authenticatorData: b64url(authData), signature: b64url(signature), userHandle: cred.userHandle },
    };
  }
}
