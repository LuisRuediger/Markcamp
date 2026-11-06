package com.markcamp.backend.baitsite;

import java.util.List;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.markcamp.backend.common.IdAlreadyExistsException;
import com.markcamp.backend.project.ProjectAccess;
import com.markcamp.backend.project.ProjectMembership;

/**
 * Every method checks access first, so a non-member gets the same 404 for everything under the project: never a 409 or
 * a validation error that would say something about the project or an id.
 */
@Service
class BaitSiteService {

	private static final Logger log = LoggerFactory.getLogger(BaitSiteService.class);

	private final BaitSiteRepository baitSiteRepository;

	private final BaitSiteReadRepository baitSiteReadRepository;

	private final BaitSiteEventService eventService;

	private final BaitSiteLock baitSiteLock;

	private final ProjectAccess projectAccess;

	private final OccurredAtValidator occurredAtValidator;

	BaitSiteService(BaitSiteRepository baitSiteRepository, BaitSiteReadRepository baitSiteReadRepository,
			BaitSiteEventService eventService, BaitSiteLock baitSiteLock, ProjectAccess projectAccess,
			OccurredAtValidator occurredAtValidator) {
		this.baitSiteRepository = baitSiteRepository;
		this.baitSiteReadRepository = baitSiteReadRepository;
		this.eventService = eventService;
		this.baitSiteLock = baitSiteLock;
		this.projectAccess = projectAccess;
		this.occurredAtValidator = occurredAtValidator;
	}

	/**
	 * The site and its first INSTALLED event are created together (ADR 0005, rule 5). The same 409 for either id, without
	 * saying which: a GET of the site tells the client whether its earlier request succeeded.
	 */
	@Transactional
	BaitSiteResponse create(UUID userId, UUID projectId, CreateBaitSiteRequest request) {
		ProjectMembership membership = this.projectAccess.requireMember(userId, projectId);
		CreateBaitSiteRequest.Validated site = request.validate(this.occurredAtValidator);

		if (this.baitSiteRepository.insertIfAbsent(site.id(), site.name(), site.latitude(), site.longitude(),
				site.locationAccuracyM(), membership) == 0) {
			throw new IdAlreadyExistsException();
		}
		// Locking a row inserted in this transaction is fine, and it keeps one path for every event write. A taken event id
		// rolls back the site above only because the exception is unchecked: by default @Transactional commits on checked
		// exceptions.
		this.eventService.append(site.installationId(), BaitSiteEventType.INSTALLED, site.installationOccurredAt(), null,
				null, this.baitSiteLock.acquire(site.id(), membership));

		// Ids only: a site's name and location say where someone keeps bees, often near their home (personal data).
		log.info("Bait site created: baitSiteId={} projectId={} userId={}", site.id(), membership.projectId(),
				membership.userId());
		// Read back because the database sets created_at.
		return toResponse(this.baitSiteReadRepository.findInProject(site.id(), membership).orElseThrow());
	}

	@Transactional(readOnly = true)
	List<BaitSiteResponse> list(UUID userId, UUID projectId) {
		ProjectMembership membership = this.projectAccess.requireMember(userId, projectId);
		return this.baitSiteReadRepository.findAllInProject(membership)
			.stream()
			.map(BaitSiteService::toResponse)
			.toList();
	}

	@Transactional(readOnly = true)
	BaitSiteResponse get(UUID userId, UUID projectId, UUID baitSiteId) {
		ProjectMembership membership = this.projectAccess.requireMember(userId, projectId);
		return this.baitSiteReadRepository.findInProject(baitSiteId, membership)
			.map(BaitSiteService::toResponse)
			.orElseThrow(BaitSiteNotFoundException::new);
	}

	private static BaitSiteResponse toResponse(BaitSiteRow row) {
		return new BaitSiteResponse(row.id(), row.name(), row.latitude(), row.longitude(), row.locationAccuracyM(),
				row.status(), row.createdAt());
	}

}
