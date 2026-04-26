// NestJS Guards
export { ZorbitJwtGuard } from './zorbit-jwt.guard';
export { ZorbitNamespaceGuard } from './zorbit-namespace.guard';
export { ZorbitPrivilegeGuard } from './zorbit-privilege.guard';

// Decorators
export { Public, IS_PUBLIC_KEY, RequirePrivileges, REQUIRED_PRIVILEGES_KEY } from './decorators';

// JWT Strategy & Payload
export { ZorbitJwtStrategy, ZorbitJwtPayload } from './jwt.strategy';

// Cycle-105 / E-JWT-SLIM: privilege_set_hash → privileges resolver.
// Exported so consumers (e.g. health endpoints) can read cache stats.
export { PrivilegeResolver } from './privilege-resolver';

// Auth dynamic module (since 0.5.0) — one-line consumer wiring.
// See 00_docs/platform/sdk-di-factory-design.md.
export { ZorbitAuthModule } from './zorbit-auth.module';
export { ZORBIT_AUTH_OPTIONS, ZorbitAuthOptions } from './zorbit-auth-options';

// Base controllers (health / manifest / seed)
export { ZorbitHealthControllerBase } from './health.controller';
export { ZorbitManifestControllerBase } from './manifest.controller';
export { ZorbitSeedControllerBase, ZorbitSeedResult } from './seed.controller';
