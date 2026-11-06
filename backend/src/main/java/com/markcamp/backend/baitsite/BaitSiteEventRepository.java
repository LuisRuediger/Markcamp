package com.markcamp.backend.baitsite;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

import com.markcamp.backend.baitsite.BaitSiteLock.LockedBaitSite;
import com.markcamp.backend.project.ProjectMembership;

// Repository, not JpaRepository: save() on an entity with an assigned id is a merge, i.e. an upsert (ADR 0002).
// Writes, the history read and the target check take a LockedBaitSite, never a bare site id, so writing into a site of
// another project, or validating without the lock, does not compile. The two read-only queries take a ProjectMembership
// and filter by its project in the query.
interface BaitSiteEventRepository extends Repository<BaitSiteEvent, UUID> {

	/**
	 * Inserts the event unless the id is taken, on any site. Returns the number of rows inserted (0 or 1).
	 */
	@Modifying
	@Query(nativeQuery = true, value = """
			INSERT INTO bait_site_events
				(id, bait_site_id, event_type, occurred_at, recorded_by, species_id, identified_event_id)
			VALUES (:id, :#{#site.baitSiteId()}, :eventType, :occurredAt, :#{#site.membership().userId()}, :speciesId,
				:identifiedEventId)
			ON CONFLICT (id) DO NOTHING
			""")
	int insertIfAbsent(UUID id, String eventType, Instant occurredAt, UUID speciesId, UUID identifiedEventId,
			LockedBaitSite site);

	/**
	 * Whether the event is on this site: of any type, voided or not. An event of another site or project is not found.
	 */
	@Query("""
			select count(e) > 0
			from BaitSiteEvent e
			where e.id = :id and e.baitSiteId = :#{#site.baitSiteId()}
			""")
	boolean existsOnSite(UUID id, LockedBaitSite site);

	/**
	 * What the state machine replays. Sorted here and only here: see {@link BaitSiteStateMachine}.
	 * <p>
	 * A separate query after the lock: under READ COMMITTED (Postgres default) each statement sees what was committed
	 * before it started, so this one sees the event another transaction committed while this one waited for the lock.
	 * Under REPEATABLE READ the snapshot is fixed at the first statement and the validation would miss it. Same dependency
	 * as user provisioning.
	 */
	@Query("""
			select new com.markcamp.backend.baitsite.BaitSiteHistoryEvent(e.id, e.eventType, e.identifiedEventId)
			from BaitSiteEvent e
			where e.baitSiteId = :#{#site.baitSiteId()} and e.voidedAt is null
			order by e.occurredAt, e.id
			""")
	List<BaitSiteHistoryEvent> findHistory(LockedBaitSite site);

	@Query("""
			select new com.markcamp.backend.baitsite.BaitSiteEventRow(e.id, e.eventType, e.occurredAt, e.speciesId,
				e.identifiedEventId, e.recordedAt)
			from BaitSiteEvent e
			join BaitSite s on s.id = e.baitSiteId
			where e.baitSiteId = :baitSiteId and s.projectId = :#{#membership.projectId()} and e.voidedAt is null
			order by e.occurredAt, e.id
			""")
	List<BaitSiteEventRow> findAllOfSite(UUID baitSiteId, ProjectMembership membership);

	/**
	 * In one query, so a missing event, an event of another site and a site of another project are the same empty result.
	 */
	@Query("""
			select new com.markcamp.backend.baitsite.BaitSiteEventRow(e.id, e.eventType, e.occurredAt, e.speciesId,
				e.identifiedEventId, e.recordedAt)
			from BaitSiteEvent e
			join BaitSite s on s.id = e.baitSiteId
			where e.id = :id and e.baitSiteId = :baitSiteId and s.projectId = :#{#membership.projectId()}
			""")
	Optional<BaitSiteEventRow> findInSite(UUID id, UUID baitSiteId, ProjectMembership membership);

}
