export type AccountRole = "guest" | "organizer";

type AccountMetadata = Record<string, unknown> | undefined;

function isAccountRole(value: unknown): value is AccountRole {
  return value === "guest" || value === "organizer";
}

/** Resolve every workspace this account is allowed to open. */
export function getAccountRoles(metadata: AccountMetadata): AccountRole[] {
  if (!metadata) return [];

  const roles = new Set<AccountRole>();
  if (isAccountRole(metadata.role)) roles.add(metadata.role);
  if (Array.isArray(metadata.roles)) {
    for (const role of metadata.roles) {
      if (isAccountRole(role)) roles.add(role);
    }
  }
  return [...roles];
}

export function hasAccountRole(metadata: AccountMetadata, role: AccountRole): boolean {
  return getAccountRoles(metadata).includes(role);
}

/** Add a workspace to an account without removing its existing workspaces. */
export function addAccountRolePatch(
  metadata: AccountMetadata,
  role: AccountRole,
): { role: AccountRole; roles: AccountRole[] } {
  const roles = new Set(getAccountRoles(metadata));
  roles.add(role);
  return {
    // Keep the legacy single-role field stable; new checks use `roles`.
    role: isAccountRole(metadata?.role) ? metadata.role : role,
    roles: [...roles],
  };
}
