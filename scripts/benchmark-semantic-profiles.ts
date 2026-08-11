import { executeSemanticProfileEvaluationCommand } from "../lib/catalog/semantic-profile-evaluation-command";

executeSemanticProfileEvaluationCommand()
  .then((summary) => {
    console.log(JSON.stringify(summary));
    if (summary.automatedGate.outcome !== "passed") process.exitCode = 1;
  })
  .catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : "Semantic Profile evaluation failed",
    );
    process.exitCode = 1;
  });
