import { lookup } from "node:dns/promises"
import { BlockList, isIP } from "node:net"

const blockedIpv4 = new BlockList()
const blockedIpv6 = new BlockList()

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["168.63.129.16", 32],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
]) {
  blockedIpv4.addSubnet(network, prefix, "ipv4")
}

for (const [network, prefix] of [
  ["::", 96],
  ["::ffff:0.0.0.0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:2::", 48],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
]) {
  blockedIpv6.addSubnet(network, prefix, "ipv6")
}

function normalizedHostname(value) {
  return String(value)
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/g, "")
    .toLowerCase()
}

export function isPublicOutboundAddress(address) {
  const normalized = normalizedHostname(address)
  const family = isIP(normalized)

  if (family === 4) {
    return !blockedIpv4.check(normalized, "ipv4")
  }

  if (family === 6) {
    return !blockedIpv6.check(normalized, "ipv6")
  }

  return false
}

async function defaultResolver(hostname) {
  return lookup(hostname, { all: true, verbatim: true })
}

export async function resolveSafeOutboundTarget(
  input,
  { resolver = defaultResolver } = {}
) {
  const url = new URL(input)
  const hostname = normalizedHostname(url.hostname)

  if (
    !["http:", "https:"].includes(url.protocol) ||
    !hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    (url.port &&
      !(
        (url.protocol === "https:" && url.port === "443") ||
        (url.protocol === "http:" && url.port === "80")
      ))
  ) {
    throw new Error("Model upstream URL is not a safe public HTTP origin.")
  }

  const literalFamily = isIP(hostname)
  let resolved

  if (literalFamily === 4 || literalFamily === 6) {
    resolved = [{ address: hostname, family: literalFamily }]
  } else {
    try {
      resolved = await resolver(hostname)
    } catch {
      throw new Error(`Unable to resolve model upstream hostname: ${hostname}.`)
    }
  }

  const addresses = [
    ...new Map(
      resolved
        .filter(
          (entry) =>
            (entry.family === 4 || entry.family === 6) &&
            isIP(entry.address) === entry.family
        )
        .map((entry) => [
          `${entry.family}:${entry.address}`,
          { address: entry.address, family: entry.family },
        ])
    ).values(),
  ]

  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => !isPublicOutboundAddress(address))
  ) {
    throw new Error(
      `Model upstream hostname ${hostname} resolves to a non-public address.`
    )
  }

  return {
    hostname,
    pinnedAddress: addresses[0],
    url,
  }
}

export function createPinnedOutboundLookup(target) {
  return (hostname, options, callback) => {
    if (normalizedHostname(hostname) !== target.hostname) {
      const error = new Error(
        "Model proxy refused an unexpected DNS lookup."
      )
      error.code = "ENOTFOUND"

      if (options.all) {
        callback(error, [])
      } else {
        callback(error, "", 0)
      }
      return
    }

    if (options.all) {
      callback(null, [target.pinnedAddress])
    } else {
      callback(
        null,
        target.pinnedAddress.address,
        target.pinnedAddress.family
      )
    }
  }
}
