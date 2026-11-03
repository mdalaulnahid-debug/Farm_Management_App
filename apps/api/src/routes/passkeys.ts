// Passkeys: sign in with one touch (fingerprint, face, Windows Hello or the device PIN). A passkey is only kept
// alongside 2-step sign-in, counts as a 2-step sign-in, and always needs the fingerprint/face/PIN check.
// Password plus the 2-step code keeps working as the backup way in.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type AuthenticatorTransport, type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { prisma } from '../db.js';
import { badRequest, conflict, notFound, unauthorized } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { audit } from '../services/common.js';
import { actorOf, can, lockedMessage, startSession, verifyPassword } from '../auth/auth.js';
import { deviceName, issueChallenge, relyingParty, takeChallenge } from '../auth/passkeys.js';

const limited = { rateLimit: { max: 10, timeWindow: '1 minute' } };
const transportsOf = (stored: string | null) => (stored ? JSON.parse(stored) : undefined) as AuthenticatorTransport[] | undefined;
const credentialBody = z.object({ id: z.string().min(1).max(1500) }).passthrough();
const passkeyName = z.string().trim().min(1).max(60);

/** The address passkeys belong to, or a clear refusal when this address cannot use them. */
const rpOf = (req: FastifyRequest) => {
  const rp = relyingParty(req);
  if (!rp) throw badRequest('Passkeys work only on the https address of FarmLedger.');
  return rp;
};

export default async function passkeyRoutes(app: FastifyInstance) {
  app.get('/auth/passkeys', { preHandler: can() }, async req => {
    const rows = await prisma.passkey.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'asc' } });
    return {
      available: relyingParty(req) !== null,
      twoStepOn: req.user!.twoStepEnabled,
      data: rows.map(p => ({ id: p.id, name: p.name, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt })),
    };
  });

  // Adding, step 1: needs 2-step on and the password, so someone at an unlocked computer cannot add their own device.
  app.post('/auth/passkeys/options', { preHandler: can(), config: limited }, async req => {
    const rp = rpOf(req);
    const body = parse(z.object({ password: z.string().min(1) }), req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, include: { passkeys: true } });
    if (!user.totpEnabledAt) throw conflict('Turn on 2-step sign-in first.');
    if (!(await verifyPassword(body.password, user.passwordHash))) throw badRequest('Password is incorrect.');
    const org = await prisma.organization.findUnique({ where: { id: 'org' }, select: { name: true } });
    const options = await generateRegistrationOptions({
      rpName: org?.name || 'FarmLedger', rpID: rp.rpID,
      userName: user.email, userDisplayName: user.name, userID: new TextEncoder().encode(user.id),
      attestationType: 'none',
      excludeCredentials: user.passkeys.map(p => ({ id: p.credentialId, transports: transportsOf(p.transports) })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    return { challengeId: issueChallenge('register', options.challenge, user.id), options };
  });

  // Step 2: the device's signed answer, checked and saved.
  app.post('/auth/passkeys', { preHandler: can(), config: limited }, async req => {
    const rp = rpOf(req);
    const body = parse(z.object({ challengeId: z.string().min(1).max(100), response: credentialBody, name: passkeyName.optional() }), req.body);
    const challenge = takeChallenge(body.challengeId, 'register');
    if (!challenge || challenge.userId !== req.user!.id) throw badRequest('Adding the passkey took too long. Try again.');
    if (!req.user!.twoStepEnabled) throw conflict('Turn on 2-step sign-in first.');
    let result;
    try {
      result = await verifyRegistrationResponse({
        response: body.response as unknown as RegistrationResponseJSON,
        expectedChallenge: challenge.challenge, expectedOrigin: rp.origin, expectedRPID: rp.rpID, requireUserVerification: true,
      });
    } catch {
      result = null;
    }
    if (!result?.verified) throw badRequest('This device could not add a passkey. It must check your fingerprint, face or PIN.');
    const { credential } = result.registrationInfo;
    const name = body.name ?? deviceName(req.headers['user-agent']);
    const saved = await prisma.passkey.create({
      data: {
        userId: req.user!.id, credentialId: credential.id, publicKey: Buffer.from(credential.publicKey), counter: credential.counter,
        transports: credential.transports ? JSON.stringify(credential.transports) : null, name,
      },
    });
    await audit(prisma, actorOf(req), 'update', 'user', req.user!.id, `Added a passkey "${name}"`);
    return { id: saved.id, name };
  });

  const ownPasskey = async (req: FastifyRequest) => {
    const { id } = req.params as { id: string };
    const passkey = await prisma.passkey.findFirst({ where: { id, userId: req.user!.id } });
    if (!passkey) throw notFound('Passkey');
    return passkey;
  };

  app.patch('/auth/passkeys/:id', { preHandler: can() }, async req => {
    const passkey = await ownPasskey(req);
    const body = parse(z.object({ name: passkeyName }), req.body);
    await prisma.passkey.update({ where: { id: passkey.id }, data: { name: body.name } });
    await audit(prisma, actorOf(req), 'update', 'user', req.user!.id, `Renamed the passkey "${passkey.name}" to "${body.name}"`);
    return { ok: true };
  });

  app.delete('/auth/passkeys/:id', { preHandler: can() }, async req => {
    const passkey = await ownPasskey(req);
    await prisma.passkey.deleteMany({ where: { id: passkey.id, userId: req.user!.id } });
    await audit(prisma, actorOf(req), 'update', 'user', req.user!.id, `Removed the passkey "${passkey.name}"`);
    return { ok: true };
  });

  // Signing in, step 1: a challenge for whichever passkey the device offers (no email needed).
  app.post('/auth/passkey/login/options', { config: limited }, async req => {
    const rp = rpOf(req);
    const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: 'required', allowCredentials: [] });
    return { challengeId: issueChallenge('login', options.challenge, null), options };
  });

  // Step 2: the signed answer. A failed check is recorded but does not count toward the account lock: nobody can
  // make one without the device, so counting it would only let a stranger lock others out.
  app.post('/auth/passkey/login', { config: limited }, async (req, reply) => {
    const rp = rpOf(req);
    const body = parse(z.object({ challengeId: z.string().min(1).max(100), response: credentialBody }), req.body);
    // Taken before any await, so two requests with the same answer cannot both use it.
    const challenge = takeChallenge(body.challengeId, 'login');
    if (!challenge) throw unauthorized('The sign-in took too long. Try again.');
    const passkey = await prisma.passkey.findUnique({ where: { credentialId: body.response.id }, include: { user: true } });
    if (!passkey) throw unauthorized('This passkey is not set up here any more. Sign in with your password.');
    const { user } = passkey;
    if (!user.active || !user.totpEnabledAt) throw unauthorized('Sign in with your password.');
    if (user.lockedUntil && user.lockedUntil > new Date()) throw unauthorized(lockedMessage(user.lockedUntil));
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response: body.response as unknown as AuthenticationResponseJSON,
        expectedChallenge: challenge.challenge, expectedOrigin: rp.origin, expectedRPID: rp.rpID, requireUserVerification: true,
        credential: { id: passkey.credentialId, publicKey: new Uint8Array(passkey.publicKey), counter: passkey.counter, transports: transportsOf(passkey.transports) },
      });
    } catch {
      result = null;
    }
    if (!result?.verified) {
      await audit(prisma, { id: user.id, ip: req.ip }, 'login_failed', 'user', user.id, `Failed sign-in for ${user.email} (passkey check failed)`);
      throw unauthorized('The passkey check failed. Try again or sign in with your password.');
    }
    await prisma.passkey.update({ where: { id: passkey.id }, data: { counter: result.authenticationInfo.newCounter, lastUsedAt: new Date() } });
    return startSession(req, reply, user, ' (passkey)');
  });
}
