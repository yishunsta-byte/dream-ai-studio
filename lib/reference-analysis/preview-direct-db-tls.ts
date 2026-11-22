import "server-only";

import { createHash, randomUUID, X509Certificate } from "node:crypto";
import { Resolver } from "node:dns/promises";
import { once } from "node:events";
import { createConnection, type Socket } from "node:net";
import { checkServerIdentity, connect, type TLSSocket } from "node:tls";

const approvedHostHash = "c64125fdc789f58cea914dd68a4cab321517d0a571ac976d3bae551bb171659a";
const port = 5432;
const release = "e784e87dc75c07f4e07f9c687bf9a8d2fa34d12d";
const targetFingerprint = "0ad1a2d0b6016a58192a68542a1dde30a87887f1307329c50b45381d5c89a462";
const caFingerprint = "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA";
// Public Supabase Root 2021 CA downloaded from the approved project's Database Settings.
const ca = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----`;
const sslRequest = Buffer.from([0, 0, 0, 8, 4, 210, 22, 47]);
const dnsCodes = new Set(["ENODATA", "ENOTFOUND", "ESERVFAIL", "ETIMEOUT", "ECONNREFUSED", "ECANCELLED"]);
const transportCodes = new Set(["ENETUNREACH", "EHOSTUNREACH", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ABORT_ERR",
  "ERR_TLS_CERT_ALTNAME_INVALID", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "CERT_HAS_EXPIRED"]);

function safeCode(error: unknown, allowed: ReadonlySet<string>, fallback: string) {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && allowed.has(code) ? code : fallback;
}

function approvedDirectHost() {
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!projectUrl) return null;
  try {
    const url = new URL(projectUrl);
    if (url.protocol !== "https:" || url.port || url.username || url.password ||
        !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) ||
        url.pathname !== "/" || url.search || url.hash) return null;
    const host = `db.${url.hostname}`;
    return createHash("sha256").update(host).digest("hex") === approvedHostHash ? host : null;
  } catch {
    return null;
  }
}

async function verifyDirectConnection(host: string, address: string, family: 4 | 6) {
  const signal = AbortSignal.timeout(3200);
  let socket: Socket | undefined;
  let secured: TLSSocket | undefined;
  let stage: "tcp" | "postgres-ssl-request" | "tls" = "tcp";
  try {
    socket = createConnection({ host: address, port, family });
    socket.on("error", () => {});
    await once(socket, "connect", { signal });
    stage = "postgres-ssl-request";
    const reply = once(socket, "data", { signal });
    socket.write(sslRequest);
    const [byte] = (await reply) as [Buffer];
    if (byte.length !== 1 || byte[0] !== 0x53) return { ok: false, stage, code: "SSL_REQUEST_REJECTED" };
    stage = "tls";
    secured = connect({ socket, servername: host, ca, rejectUnauthorized: true, checkServerIdentity });
    secured.on("error", () => {});
    await once(secured, "secureConnect", { signal });
    if (!secured.encrypted || !secured.authorized) return { ok: false, stage, code: "TLS_NOT_VERIFIED" };
    return { ok: true, stage, version: secured.getProtocol() };
  } catch (error) {
    return { ok: false, stage, code: safeCode(error, transportCodes, "CONNECTION_FAILED") };
  } finally {
    secured?.destroy();
    socket?.destroy();
  }
}

export async function inspectStyleDnaDirectTls() {
  const region = process.env.VERCEL_REGION;
  const deployment = process.env.VERCEL_DEPLOYMENT_ID;
  const commit = process.env.VERCEL_GIT_COMMIT_SHA;
  const result = {
    schema: 1, runId: randomUUID(), observedAt: new Date().toISOString(), release,
    runtime: { platform: process.platform, arch: process.arch, node: process.version,
      region: region && /^[a-z]{3}[0-9]{1,3}$/.test(region) ? region : null,
      deploymentFingerprint: deployment && /^dpl_[a-zA-Z0-9]+$/.test(deployment) ? createHash("sha256").update(deployment).digest("hex") : null,
      commit: commit && /^[a-f0-9]{40}$/.test(commit) ? commit : null },
    target: { mode: "direct", port, fingerprint: targetFingerprint },
    postgresStartupSent: false, backendTls: null,
  };

  const host = approvedDirectHost();
  if (!host) {
    return { ...result, clientTlsVerified: false, code: "TARGET_NOT_VERIFIED", families: [] };
  }
  const certificate = new X509Certificate(ca);
  const now = Date.now();
  if (certificate.fingerprint256 !== caFingerprint || !certificate.ca || !certificate.verify(certificate.publicKey) ||
      Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) <= now) {
    return { ...result, clientTlsVerified: false, code: "CA_NOT_VERIFIED", families: [] };
  }

  const dns = new Resolver({ timeout: 1800, tries: 1 });
  const families = await Promise.all(([4, 6] as const).map(async family => {
    let addresses: string[];
    try { addresses = await (family === 4 ? dns.resolve4(host) : dns.resolve6(host)); }
    catch (error) {
      return { family, addresses: 0, dnsCode: safeCode(error, dnsCodes, "DNS_FAILED"), attempt: null };
    }
    const attempt = addresses.length ? await verifyDirectConnection(host, addresses[0], family) : null;
    return { family, addresses: addresses.length, dnsCode: null, attempt };
  }));
  return { ...result, clientTlsVerified: families.some(item => item.attempt?.ok === true), families };
}
