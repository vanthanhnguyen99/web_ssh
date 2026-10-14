import type { AuthorizationService } from "./ports.js";
import { DomainError } from "./errors.js";
export class OwnershipAuthorization implements AuthorizationService {
  owned(ownerId: string, actorId: string): void {
    if (ownerId !== actorId)
      throw new DomainError(
        "SESSION_NOT_OWNED",
        "Resource is not owned by this user",
        403,
      );
  }
}
