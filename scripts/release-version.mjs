const semverPattern =
  /^(?:(?:compshare-)?v)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/

export function parseReleaseVersion(value) {
  const releaseName = value?.trim()
  if (!releaseName) {
    return null
  }

  const match = releaseName.match(semverPattern)
  if (!match) {
    throw new Error(
      `Release tag/version must be semver with an optional leading "v" or "compshare-v"; received "${value}".`
    )
  }

  return match[1]
}

export function readReleaseVersion(environment = process.env) {
  const releaseName =
    environment.ASTRAFLOW_RELEASE_VERSION ||
    (environment.GITHUB_REF_TYPE === "tag"
      ? environment.GITHUB_REF_NAME
      : "") ||
    (environment.GITHUB_REF?.startsWith("refs/tags/")
      ? environment.GITHUB_REF.slice("refs/tags/".length)
      : "")

  return parseReleaseVersion(releaseName)
}
