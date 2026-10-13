function ipv4(value: string): bigint | null {
  const octets = value.split(".");
  if (octets.length !== 4 || octets.some(part => !/^(0|[1-9][0-9]{0,2})$/.test(part) || Number(part) > 255)) return null;
  return octets.reduce((result, part) => (result << BigInt(8)) | BigInt(part), BigInt(0));
}

function ipv6(value: string): bigint | null {
  const lower = value.toLowerCase();
  if (!/^[0-9a-f:.]+$/.test(lower) || lower.includes(":::")) return null;
  const double = lower.indexOf("::");
  if (double !== -1 && lower.indexOf("::", double + 2) !== -1) return null;
  let source = lower;
  if (source.includes(".")) {
    const lastColon = source.lastIndexOf(":");
    const tail = ipv4(source.slice(lastColon + 1));
    if (tail === null) return null;
    source = `${source.slice(0, lastColon)}:${Number(tail >> BigInt(16)).toString(16)}:${Number(tail & BigInt(65535)).toString(16)}`;
  }
  const left = double === -1 ? source.split(":") : source.slice(0, source.indexOf("::")).split(":").filter(Boolean);
  const right = double === -1 ? [] : source.slice(source.indexOf("::") + 2).split(":").filter(Boolean);
  const groups = double === -1 ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  if (groups.length !== 8 || groups.some(part => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return groups.reduce((result, part) => (result << BigInt(16)) | BigInt(`0x${part}`), BigInt(0));
}

function parsed(value: string) {
  const v4 = ipv4(value);
  if (v4 !== null) return { family: 4, bits: 32, value: v4 };
  const v6 = ipv6(value);
  if (v6 !== null) return { family: 6, bits: 128, value: v6 };
  return null;
}

export function validIpRange(range: string): boolean {
  const [address, prefix, extra] = range.split("/");
  const ip = parsed(address);
  return !extra && !!ip && (prefix === undefined || (/^(0|[1-9][0-9]{0,2})$/.test(prefix) && Number(prefix) <= ip.bits));
}

export function ipAllowed(address: string | null, ranges: string[]): boolean {
  if (!address) return false;
  const ip = parsed(address);
  if (!ip) return false;
  return ranges.some(range => {
    const [base, prefix] = range.split("/");
    const network = parsed(base);
    if (!network || network.family !== ip.family || !validIpRange(range)) return false;
    const hostBits = BigInt(ip.bits - (prefix === undefined ? ip.bits : Number(prefix)));
    return (ip.value >> hostBits) === (network.value >> hostBits);
  });
}
