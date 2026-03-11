/**
 * Zorbit namespace types.
 */
export enum NamespaceType {
  Global = 'G',
  Organization = 'O',
  Department = 'D',
  User = 'U',
}

/**
 * Parsed namespace object.
 */
export interface Namespace {
  type: NamespaceType;
  id: string;
}

/**
 * JWT claims structure expected by namespace utilities.
 */
export interface NamespaceClaims {
  sub?: string;
  org?: string;
  orgs?: string[];
  dept?: string;
  depts?: string[];
  [key: string]: unknown;
}

/**
 * Parse a namespace from type and ID strings.
 *
 * @param type - Namespace type character (G, O, D, U)
 * @param id - Namespace identifier
 * @returns Parsed namespace object
 * @throws Error if the namespace type is invalid
 */
export function parseNamespace(type: string, id: string): Namespace {
  const namespaceType = Object.values(NamespaceType).find((t) => t === type);

  if (!namespaceType) {
    throw new Error(`Invalid namespace type: ${type}. Expected one of: ${Object.values(NamespaceType).join(', ')}`);
  }

  return { type: namespaceType, id };
}

/**
 * Validate that the user's JWT claims grant access to the requested namespace.
 *
 * Rules:
 * - Global (G): Always accessible (authorization handled at privilege level)
 * - Organization (O): User must belong to the organization (org or orgs claim)
 * - Department (D): User must belong to the department (dept or depts claim)
 * - User (U): User ID must match the namespace ID (sub claim)
 *
 * @param claims - Decoded JWT claims
 * @param namespace - Requested namespace
 * @returns True if access is granted
 */
export function validateNamespaceAccess(
  claims: NamespaceClaims,
  namespace: Namespace,
): boolean {
  switch (namespace.type) {
    case NamespaceType.Global:
      return true;

    case NamespaceType.Organization: {
      if (claims.org === namespace.id) return true;
      if (Array.isArray(claims.orgs) && claims.orgs.includes(namespace.id)) return true;
      return false;
    }

    case NamespaceType.Department: {
      if (claims.dept === namespace.id) return true;
      if (Array.isArray(claims.depts) && claims.depts.includes(namespace.id)) return true;
      return false;
    }

    case NamespaceType.User: {
      return claims.sub === namespace.id;
    }

    default:
      return false;
  }
}
