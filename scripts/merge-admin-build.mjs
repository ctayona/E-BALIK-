// Vercel build step: serve the admin console from the same site as the user app, under /admin/.
// The admin build (base "/admin/") is copied into the user build output, so one deployment hosts both
// apps and the admin sign-in redirect and token hand-off stay on a single origin.
import { cpSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const userDist = resolve(root, "Users/Frontend/dist");
const adminDist = resolve(root, "Admin/Frontend/dist");
const target = resolve(userDist, "admin");

for (const [name, dir] of [["user", userDist], ["admin", adminDist]]) {
  if (!existsSync(resolve(dir, "index.html"))) {
    console.error(`The ${name} build is missing (${dir}). Run the build before merging.`);
    process.exit(1);
  }
}

rmSync(target, { recursive: true, force: true });
cpSync(adminDist, target, { recursive: true });
console.log(`Admin console copied to ${target}`);
