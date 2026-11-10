export interface PackageProjectInfo {
  author: string | { name: string; url?: string };
  copyright: string;
  license: string;
  homepage: string;
  repository: string | { url: string };
  bugs: string | { url: string };
}

export interface ProjectMetadata {
  author: string;
  copyright: string;
  license: string;
  homepageURL: string;
  supportURL: string;
  source: string;
}

export function createProjectMetadata(info: PackageProjectInfo): Readonly<ProjectMetadata>;
export function createLicenseNotice(text: string, copyright: string): string;
export const projectMetadata: Readonly<ProjectMetadata>;
export const licenseText: string;
export const licenseNotice: string;
export function attachLicenseNotice(userscript: string): string;
