// Runs first in `npm run build:vercel`. On Vercel, a missing or wrong VITE_API_URL would not break the build:
// the site would ship and quietly call http://localhost:5000, so every feature would look broken.
// Fail the build here with a clear message instead.
const onVercel = Boolean(process.env.VERCEL);
const url = (process.env.VITE_API_URL || "").trim();

function fail(message) {
  console.error(`\nDeployment check failed: ${message}\nSet it in Vercel > Settings > Environment Variables, then redeploy. See DEPLOYMENT_GUIDE.md, Step 3.\n`);
  process.exit(1);
}

if (!onVercel) {
  console.log("Not running on Vercel: skipping the deployment environment check.");
} else if (!url) {
  fail("VITE_API_URL is not set.");
} else if (!/^https:\/\/[^/\s]+$/.test(url)) {
  fail(`VITE_API_URL must be an https address with no trailing slash or path (got "${url}"), for example https://ebalik-api.onrender.com`);
} else if (/localhost|127\.0\.0\.1/.test(url)) {
  fail("VITE_API_URL points at localhost.");
} else {
  console.log(`Deployment check passed: the site will call ${url}`);
  if (process.env.VITE_ADMIN_URL) console.warn("Warning: VITE_ADMIN_URL is set. Leave it unset so the admin console opens at /admin/.");
}
