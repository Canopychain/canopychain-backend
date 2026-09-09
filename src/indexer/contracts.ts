/** Deployed contract IDs the indexer watches. Empty until set post-deploy. */
export const PROJECT_REGISTRY_CONTRACT_ID = process.env.PROJECT_REGISTRY_CONTRACT_ID ?? '';
export const MILESTONE_VAULT_CONTRACT_ID = process.env.MILESTONE_VAULT_CONTRACT_ID ?? '';

export const WATCHED_CONTRACT_IDS = [
  PROJECT_REGISTRY_CONTRACT_ID,
  MILESTONE_VAULT_CONTRACT_ID,
].filter((id) => id.length > 0);
