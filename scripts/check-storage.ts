import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

// Standalone R2 verification (P3): round-trips one object through the
// storage seam, then deletes it. Requires the R2_* env vars.
//
//   npm run check:storage

import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getObject, putObject, storageConfigured } from "../src/lib/storage";

async function main() {
  if (!storageConfigured()) {
    throw new Error("R2_* env vars are not set — nothing to check");
  }

  const key = `healthchecks/check-storage-${Date.now()}.txt`;
  const payload = `storage ok ${new Date().toISOString()}`;

  await putObject(key, payload, "text/plain; charset=utf-8");
  console.log(`put:  ${key}`);

  const roundTripped = (await getObject(key)).toString("utf8");
  console.log(`get:  ${roundTripped}`);
  if (roundTripped !== payload) {
    throw new Error("Round-tripped content does not match what was written");
  }

  // Cleanup (the seam intentionally has no delete — artifacts are immutable)
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
  await client.send(
    new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key }),
  );
  console.log("del:  cleaned up");
  console.log("OK: R2 storage round-trip verified");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
