export const isSelfHostedMode = () =>
  process.env.NEXT_PUBLIC_APP_MODE !== "valyu";

export const appMode = process.env.NEXT_PUBLIC_APP_MODE === "valyu"
  ? "valyu"
  : "self-hosted";
