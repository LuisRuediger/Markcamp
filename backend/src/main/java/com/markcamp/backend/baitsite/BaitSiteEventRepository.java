package com.markcamp.backend.baitsite;

import java.time.Instant;
import java.util.UUID;

import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

import com.markcamp.backend.project.ProjectMembership;

// Repository, not JpaRepository: save() on an entity with an assigned id is a merge, i.e. an upsert (ADR 0002).
interface BaitSiteEventRepository extends Repository<BaitSiteEvent, UUID> {

	/**
	 * Inserts the event unless the id is taken, on any site. Returns the number of rows inserted (0 or 1).
	 */
	@Modifying
	@Query(nativeQuery = true, value = """
			INSERT INTO bait_site_events (id, bait_site_id, event_type, occurred_at, recorded_by)
			VALUES (:id, :baitSiteId, :eventType, :occurredAt, :#{#membership.userId()})
			ON CONFLICT (id) DO NOTHING
			""")
	int insertIfAbsent(UUID id, UUID baitSiteId, String eventType, Instant occurredAt, ProjectMembership membership);

}
