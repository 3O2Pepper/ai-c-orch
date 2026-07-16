import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

// Standalone E2B verification (P3): runs a tiny Python program in a fresh
// sandbox and collects a file it writes. Requires E2B_API_KEY.
//
//   npm run check:sandbox

import { runPythonInSandbox, sandboxConfigured } from "../src/lib/sandbox";

const CODE = `
with open("/home/user/proof.txt", "w") as f:
    f.write("sandbox file ok")
print("sandbox stdout ok")
`;

async function main() {
  if (!sandboxConfigured()) {
    throw new Error("E2B_API_KEY is not set — nothing to check");
  }

  const run = await runPythonInSandbox({
    code: CODE,
    collectFiles: ["/home/user/proof.txt"],
  });

  console.log(`ok:     ${run.ok}`);
  console.log(`stdout: ${run.stdout.trim()}`);
  if (run.error) console.log(`error:  ${run.error}`);

  const file = run.files.find((f) => f.path === "/home/user/proof.txt");
  const fileText = file
    ? Buffer.from(file.contentBase64, "base64").toString("utf8")
    : null;
  console.log(`file:   ${fileText}`);

  if (!run.ok || run.stdout.trim() !== "sandbox stdout ok" || fileText !== "sandbox file ok") {
    throw new Error("Sandbox run did not produce the expected output");
  }
  console.log("OK: E2B sandbox execution + file collection verified");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
