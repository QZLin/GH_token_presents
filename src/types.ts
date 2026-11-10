export interface OffsetExpiration {
  mode: 'offset';
  /** Positive offset in local calendar days; never a captured absolute date. */
  days: number;
}

export interface CustomExpiration {
  mode: 'custom';
  date: string | null;
}

export type Expiration = OffsetExpiration | CustomExpiration | { mode: 'none' };
export type Permissions = Record<string, string>;
export type RepositoryAccess = 'public' | 'all' | 'selected';

export interface Profile {
  permissions: Permissions;
  expiration: Expiration | null;
  repositoryAccess: RepositoryAccess | null;
}

export type ProfileStore = Record<string, Profile>;
export type StatusReporter = (message: string) => void;

export interface ApplyOptions {
  removeUnrecordedPermissions?: boolean;
}

export interface ApplyResult {
  permissionsApplied: number;
  permissionsTotal: number;
  permissionsRemoved: number;
  permissionsToRemove: number;
  unrecognizedPermissions: number;
  expirationApplied: boolean;
  repositoryAccessApplied: boolean;
  permissionSurfaceReady: boolean;
}
