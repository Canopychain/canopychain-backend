import { MILESTONE_VAULT_CONTRACT_ID, PROJECT_REGISTRY_CONTRACT_ID } from './contracts.js';
import { handleProjectRegistryEvent } from './handlers/projectRegistry.js';
import type { ContractEvent, EventHandler } from './worker.js';

export const dispatchEvent: EventHandler = async (event: ContractEvent) => {
  switch (event.contractId?.toString()) {
    case PROJECT_REGISTRY_CONTRACT_ID:
      await handleProjectRegistryEvent(event);
      break;
    case MILESTONE_VAULT_CONTRACT_ID:
      // Handled in an upcoming commit.
      break;
    default:
      break;
  }
};
