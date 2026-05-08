import { runSkillSync } from "./skill-sync.mjs";

const passthrough = process.argv.slice(2).filter((arg) => arg !== "--check");
runSkillSync(["--check", ...passthrough])
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
