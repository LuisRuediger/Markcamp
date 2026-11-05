package com.markcamp.backend.baitsite;

import java.util.UUID;

import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import com.markcamp.backend.project.ProjectMembership;

/**
 * Serializes the writes of one bait site. Without it, two concurrent requests read the same history; each one is valid
 * alone and together they are invalid (write skew; e.g. COLLECTED and LOST at the same time after a CAPTURED). Events are
 * immutable, so a corrupted history cannot be fixed with an UPDATE.
 */
@Component
class BaitSiteLock {

	private final BaitSiteRepository baitSiteRepository;

	BaitSiteLock(BaitSiteRepository baitSiteRepository) {
		this.baitSiteRepository = baitSiteRepository;
	}

	/**
	 * Locks the row of the site until the current transaction ends. Requests on different sites never block each other.
	 * Keep the transaction short: no external calls while holding the lock.
	 * <p>
	 * MANDATORY because a lock outside a transaction is released at once, so a LockedBaitSite obtained that way would be a
	 * lie.
	 * <p>
	 * An operation that locks more than one site (e.g. a single "move bait" request) must lock them in id order, to avoid
	 * deadlocks. Today every transaction locks one row.
	 */
	@Transactional(propagation = Propagation.MANDATORY)
	LockedBaitSite acquire(UUID baitSiteId, ProjectMembership membership) {
		return this.baitSiteRepository.lockInProject(baitSiteId, membership)
			.map((id) -> new LockedBaitSite(id, membership))
			.orElseThrow(BaitSiteNotFoundException::new);
	}

	/**
	 * Holding one proves two things: the site belongs to the caller's project, and its row is locked in the current
	 * transaction. Do not keep one after that transaction.
	 * <p>
	 * A private constructor, not the package-private one of ProjectMembership: all event code lives in this package, so
	 * package-private would stop nothing. The accessors are public because the repositories read them through SpEL.
	 */
	static final class LockedBaitSite {

		private final UUID baitSiteId;

		private final ProjectMembership membership;

		private LockedBaitSite(UUID baitSiteId, ProjectMembership membership) {
			this.baitSiteId = baitSiteId;
			this.membership = membership;
		}

		public UUID baitSiteId() {
			return this.baitSiteId;
		}

		public ProjectMembership membership() {
			return this.membership;
		}

	}

}
