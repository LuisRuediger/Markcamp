package com.markcamp.backend.baitsite;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.markcamp.backend.baitsite.BaitSiteLock.LockedBaitSite;
import com.markcamp.backend.common.IdAlreadyExistsException;
import com.markcamp.backend.project.ProjectAccess;
import com.markcamp.backend.project.ProjectMembership;
import com.markcamp.backend.species.SpeciesCatalog;

/**
 * Every method checks access first, so a non-member gets the same 404 for everything under the project: never a 409 or
 * a validation error that would say something about the project or an id.
 */
@Service
class BaitSiteEventService {

	private static final Logger log = LoggerFactory.getLogger(BaitSiteEventService.class);

	private final BaitSiteEventRepository eventRepository;

	private final BaitSiteRepository baitSiteRepository;

	private final BaitSiteLock baitSiteLock;

	private final ProjectAccess projectAccess;

	private final OccurredAtValidator occurredAtValidator;

	private final SpeciesCatalog speciesCatalog;

	BaitSiteEventService(BaitSiteEventRepository eventRepository, BaitSiteRepository baitSiteRepository,
			BaitSiteLock baitSiteLock, ProjectAccess projectAccess, OccurredAtValidator occurredAtValidator,
			SpeciesCatalog speciesCatalog) {
		this.eventRepository = eventRepository;
		this.baitSiteRepository = baitSiteRepository;
		this.baitSiteLock = baitSiteLock;
		this.projectAccess = projectAccess;
		this.occurredAtValidator = occurredAtValidator;
		this.speciesCatalog = speciesCatalog;
	}

	@Transactional
	BaitSiteEventResponse recordEvent(UUID userId, UUID projectId, UUID baitSiteId, RecordBaitSiteEventRequest request) {
		ProjectMembership membership = this.projectAccess.requireMember(userId, projectId);
		RecordBaitSiteEventRequest.Validated event = request.validate(this.occurredAtValidator, this.speciesCatalog);
		LockedBaitSite site = this.baitSiteLock.acquire(baitSiteId, membership);

		append(event.id(), event.type(), event.occurredAt(), event.speciesId(), event.identifiedEventId(), site);

		// Ids and type only: never the name or location of a site (personal data).
		log.info("Bait site event recorded: eventId={} baitSiteId={} projectId={} userId={} type={}", event.id(),
				site.baitSiteId(), membership.projectId(), membership.userId(), event.type());
		// Read back because the database sets recorded_at.
		return toResponse(this.eventRepository.findInSite(event.id(), site.baitSiteId(), membership).orElseThrow());
	}

	/**
	 * The one path for every event write (ADR 0005, rule 5): insert, then replay the resulting history, and roll back if it
	 * is invalid.
	 * <p>
	 * Insert first because, if the sequence were validated before the insert, a resend of an event that is already stored
	 * would enter the replay twice (e.g. two COLLECTED), fail as an invalid sequence, and the client would give up on an
	 * event that was in fact saved. Inserting first makes that resend a 409 ID_ALREADY_EXISTS, which the client confirms
	 * with a GET. {@link #voidEvent} follows the same pattern: change, validate the resulting history, roll back if
	 * invalid.
	 * <p>
	 * The target check of an IDENTIFIED comes before the insert and keeps that guarantee: events are never deleted, so the
	 * target of a stored IDENTIFIED is still there, and its resend reaches the insert and gets the 409 ID_ALREADY_EXISTS.
	 */
	void append(UUID id, BaitSiteEventType type, Instant occurredAt, UUID speciesId, UUID identifiedEventId,
			LockedBaitSite site) {
		// Here and not in the replay: the composite foreign key (bait_site_id, identified_event_id) would fail on the insert
		// first and become a 500 (ADR 0006, rule 3). Only existence: the other rules on the target are in the replay.
		if (type == BaitSiteEventType.IDENTIFIED && !this.eventRepository.existsOnSite(identifiedEventId, site)) {
			throw new InvalidEventSequenceException();
		}
		if (this.eventRepository.insertIfAbsent(id, type.name(), occurredAt, speciesId, identifiedEventId, site) == 0) {
			throw new IdAlreadyExistsException();
		}
		requireValidHistory(site);
	}

	/**
	 * Voids one event, or does nothing if it is already voided (ADR 0006: voiding is idempotent). The replay decides what
	 * can be voided: an event that later events depend on leaves an invalid history, with no rule specific to voiding.
	 * <p>
	 * The lock matters here too: without it, voiding a CAPTURED and recording an IDENTIFIED that points to it can each pass
	 * their replay and commit together (write skew).
	 */
	@Transactional
	BaitSiteEventResponse voidEvent(UUID userId, UUID projectId, UUID baitSiteId, UUID eventId) {
		ProjectMembership membership = this.projectAccess.requireMember(userId, projectId);
		LockedBaitSite site = this.baitSiteLock.acquire(baitSiteId, membership);

		boolean voidedNow = this.eventRepository.voidIfNotVoided(eventId, site) == 1;
		if (voidedNow) {
			requireValidHistory(site);
		}
		else if (!this.eventRepository.existsOnSite(eventId, site)) {
			throw new BaitSiteEventNotFoundException();
		}

		// Read back because the database sets voided_at. A projection, so it hits the database: nothing in this transaction
		// loads a BaitSiteEvent entity that could hold a stale voidedAt.
		BaitSiteEventRow event = this.eventRepository.findInSite(eventId, site.baitSiteId(), membership).orElseThrow();
		if (voidedNow) {
			// Ids and type only: never the name or location of a site (personal data).
			log.info("Bait site event voided: eventId={} baitSiteId={} projectId={} userId={} type={}", eventId,
					site.baitSiteId(), membership.projectId(), membership.userId(), event.type());
		}
		return toResponse(event);
	}

	private void requireValidHistory(LockedBaitSite site) {
		if (BaitSiteStateMachine.replay(this.eventRepository.findHistory(site)) instanceof BaitSiteStateMachine.Invalid) {
			throw new InvalidEventSequenceException();
		}
	}

	/**
	 * Read only, so no lock. The site is checked on its own to tell a missing site from an empty list.
	 */
	@Transactional(readOnly = true)
	List<BaitSiteEventResponse> list(UUID userId, UUID projectId, UUID baitSiteId) {
		ProjectMembership membership = this.projectAccess.requireMember(userId, projectId);
		if (!this.baitSiteRepository.existsInProject(baitSiteId, membership)) {
			throw new BaitSiteNotFoundException();
		}
		return this.eventRepository.findAllOfSite(baitSiteId, membership)
			.stream()
			.map(BaitSiteEventService::toResponse)
			.toList();
	}

	@Transactional(readOnly = true)
	BaitSiteEventResponse get(UUID userId, UUID projectId, UUID baitSiteId, UUID eventId) {
		ProjectMembership membership = this.projectAccess.requireMember(userId, projectId);
		return this.eventRepository.findInSite(eventId, baitSiteId, membership)
			.map(BaitSiteEventService::toResponse)
			.orElseThrow(BaitSiteEventNotFoundException::new);
	}

	private static BaitSiteEventResponse toResponse(BaitSiteEventRow row) {
		return new BaitSiteEventResponse(row.id(), row.type(), row.occurredAt(), row.speciesId(), row.identifiedEventId(),
				row.recordedAt(), row.voidedAt());
	}

}
