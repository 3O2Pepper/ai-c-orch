import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

// Artifact object storage (P3, PLAN §8): Cloudflare R2 via the
// S3-compatible API. Env-gated seam — when R2 is not configured, artifact
// content stays inline in Postgres (the P1/P2 path, lossless for text) and
// binary-producing phases are gated off upstream.
//
// Verified against a live R2 bucket via `npm run check:storage` and
// end-to-end runs (text + binary artifacts).

const REQUIRED_ENV = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
] as const;

export function storageConfigured(): boolean {
  return REQUIRED_ENV.every((k) => Boolean(process.env[k]));
}

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!storageConfigured()) {
    throw new Error(
      `Object storage is not configured — set ${REQUIRED_ENV.join(", ")} in .env.local`,
    );
  }
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return client;
}

export async function putObject(
  key: string,
  body: Buffer | string,
  contentType: string,
): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET!,
      Key: key,
      Body: typeof body === "string" ? Buffer.from(body, "utf8") : body,
      ContentType: contentType,
    }),
  );
}

export async function getObject(key: string): Promise<Buffer> {
  const res = await getClient().send(
    new GetObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key }),
  );
  if (!res.Body) throw new Error(`Object ${key} has no body`);
  return Buffer.from(await res.Body.transformToByteArray());
}
